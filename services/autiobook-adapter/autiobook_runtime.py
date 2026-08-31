"""Pinned autiobook execution with pipeline-isolated content addressing."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from adapter_core import (
    CONTRACT_VERSION,
    EXTRACTOR_VERSION,
    PROVIDER,
    PROVIDER_VERSION,
    adapt_upstream_result,
)


PIPELINE_ID = "external"
PIPELINE_IMPLEMENTATION_VERSION = "external-autiobook-v1.d532bdd0"
NORMALIZATION_VERSION = "normalized-text-v1"
OUTPUT_SCHEMA_VERSION = 3


class UpstreamError(RuntimeError):
    pass


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _write_text_if_changed(path: Path, value: str) -> None:
    if path.exists() and path.read_text(encoding="utf-8") == value:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def _write_json_if_changed(path: Path, value: Any) -> None:
    rendered = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    _write_text_if_changed(path, rendered)


class AutiobookRuntime:
    def __init__(
        self,
        *,
        work_root: str,
        api_base: str,
        api_key: str,
        model: str,
        command: str = "autiobook",
        timeout_seconds: int = 3_600,
        seed: int = 18_082_026,
        cast_chunk_words: int = 1_500,
        cast_chunk_overlap_words: int = 400,
    ) -> None:
        if not api_base or not api_key or not model:
            raise ValueError(
                "AUTIOBOOK_LLM_BASE_URL, AUTIOBOOK_LLM_API_KEY and model are required"
            )
        self.work_root = Path(work_root)
        self.api_base = api_base
        self.api_key = api_key
        self.model = model
        self.command = command
        self.timeout_seconds = timeout_seconds
        self.seed = seed
        self.cast_chunk_words = cast_chunk_words
        self.cast_chunk_overlap_words = cast_chunk_overlap_words

    def _configuration(self) -> dict[str, Any]:
        return {
            "pipelineId": PIPELINE_ID,
            "pipelineImplementationVersion": PIPELINE_IMPLEMENTATION_VERSION,
            "providerVersion": PROVIDER_VERSION,
            "normalizationVersion": NORMALIZATION_VERSION,
            "outputSchemaVersion": OUTPUT_SCHEMA_VERSION,
            "model": self.model,
            "seed": self.seed,
            "castChunkWords": self.cast_chunk_words,
            "castChunkOverlapWords": self.cast_chunk_overlap_words,
            "revise": False,
        }

    def _run(self, phase: str, workdir: Path) -> str:
        environment = os.environ.copy()
        environment.update(
            {
                "OPENAI_BASE_URL": self.api_base,
                "OPENAI_API_KEY": self.api_key,
                "AUTIOBOOK_LLM_MODEL": self.model,
                "AUTIOBOOK_CAST_CHUNK_WORDS": str(self.cast_chunk_words),
                "AUTIOBOOK_CAST_CHUNK_OVERLAP_WORDS": str(
                    self.cast_chunk_overlap_words
                ),
                "AUTIOBOOK_SEED": str(self.seed),
            }
        )
        command = [
            self.command,
            phase,
            str(workdir),
            "--llm-model",
            self.model,
            "--seed",
            str(self.seed),
        ]
        try:
            completed = subprocess.run(
                command,
                env=environment,
                check=True,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
        except subprocess.TimeoutExpired as error:
            raise UpstreamError(f"autiobook {phase} timed out") from error
        except subprocess.CalledProcessError as error:
            raise UpstreamError(f"autiobook {phase} failed") from error
        return (completed.stdout or "")[-4_000:]

    def analyze(self, request: dict[str, str]) -> dict[str, Any]:
        configuration = self._configuration()
        request_hash = _canonical_hash(
            {
                "contractVersion": CONTRACT_VERSION,
                "sourceSha256": request["sha256"],
                "configuration": configuration,
            }
        )
        implementation_hash = hashlib.sha256(
            PIPELINE_IMPLEMENTATION_VERSION.encode("utf-8")
        ).hexdigest()[:16]
        workdir = self.work_root / PIPELINE_ID / implementation_hash / request_hash[:32]
        workdir.mkdir(parents=True, exist_ok=True)
        lock_path = workdir / ".lock"
        with lock_path.open("a+", encoding="utf-8") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            cache_path = workdir / "adapter-result.json"
            if cache_path.exists():
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
                if cached.get("requestHash") == request_hash:
                    return cached["response"]

            extract_dir = workdir / "extract"
            _write_text_if_changed(extract_dir / "01_Book.txt", request["text"])
            _write_json_if_changed(
                extract_dir / "metadata.json",
                {
                    "title": "Narra normalized book",
                    "author": "",
                    "language": "ru",
                    "chapters": [
                        {
                            "index": 1,
                            "title": "Book",
                            "filename_base": "01_Book",
                            "href": "narra-normalized-text",
                        }
                    ],
                },
            )
            self._run("cast", workdir)
            self._run("script", workdir)
            cast_path = workdir / "cast" / "characters.json"
            if not cast_path.exists():
                raise UpstreamError("autiobook did not create cast/characters.json")
            cast = json.loads(cast_path.read_text(encoding="utf-8"))
            scripts = [
                json.loads(path.read_text(encoding="utf-8"))
                for path in sorted((workdir / "script").glob("*.json"))
                if path.name != "state.json"
            ]
            if not scripts:
                raise UpstreamError("autiobook did not create script JSON files")
            adapted = adapt_upstream_result(request["text"], cast, scripts)
            response = {
                "contractVersion": CONTRACT_VERSION,
                "provider": {
                    "name": PROVIDER,
                    "upstreamRevision": PROVIDER_VERSION,
                    "model": self.model,
                    "castChunkWords": self.cast_chunk_words,
                    "castOverlapWords": self.cast_chunk_overlap_words,
                    "revise": False,
                },
                "extractorVersion": EXTRACTOR_VERSION,
                "sourceSha256": request["sha256"],
                "observations": adapted["observations"],
                "diagnostics": adapted["diagnostics"],
            }
            cache_record = {"requestHash": request_hash, "response": response}
            with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", dir=workdir, delete=False
            ) as temporary:
                json.dump(cache_record, temporary, ensure_ascii=False)
                temporary.write("\n")
                temporary_path = Path(temporary.name)
            temporary_path.replace(cache_path)
            return response
