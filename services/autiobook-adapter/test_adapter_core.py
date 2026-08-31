import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from adapter_core import adapt_upstream_result, utf16_offset, validate_request
from autiobook_runtime import AutiobookRuntime


class AdapterCoreTest(unittest.TestCase):
    def test_utf16_offsets_match_javascript_for_cyrillic_and_emoji(self):
        source = "А😀Б"
        self.assertEqual([utf16_offset(source, value) for value in range(4)], [0, 1, 3, 4])

    def test_request_rejects_a_source_hash_mismatch(self):
        with self.assertRaisesRegex(ValueError, "does not match"):
            validate_request(
                {
                    "contractVersion": "autiobook-adapter-v1",
                    "idempotencyKey": "job-1",
                    "source": {"text": "Книга", "sha256": "0" * 64},
                }
            )

    def test_exact_alignment_maps_alias_and_drops_rewritten_text(self):
        source = "Лариса: Привет.\nКнуров: Ответ.\nЛариса: Пока."
        cast = {
            "characters": [
                {
                    "name": "Лариса Дмитриевна",
                    "aliases": ["Лариса"],
                    "description": "must not leak",
                },
                {"name": "Мокий Парменыч Кнуров", "aliases": ["Кнуров"]},
            ]
        }
        scripts = [
            {
                "segments": [
                    {"speaker": "Лариса", "text": "Привет."},
                    {"speaker": "Кнуров", "text": "Изменённый ответ."},
                    {"speaker": "Лариса", "text": "Пока."},
                ]
            }
        ]
        result = adapt_upstream_result(source, cast, scripts)
        dialogue = [
            item for item in result["observations"]
            if item["type"] == "character_dialogue"
        ]
        self.assertEqual(
            [item["evidence"]["quote"] for item in dialogue],
            ["Привет.", "Пока."],
        )
        self.assertTrue(
            all(item["entityCandidate"] == "Лариса Дмитриевна" for item in dialogue)
        )
        self.assertEqual(result["diagnostics"]["droppedSegments"], 1)
        self.assertNotIn("description", str(result))

    def test_synthetic_speakers_never_become_characters(self):
        result = adapt_upstream_result(
            "Текст. Шёпот.",
            {"characters": [{"name": "Narrator"}, {"name": "Голос с улицы"}]},
            [{"segments": [
                {"speaker": "Narrator", "text": "Текст."},
                {"speaker": "Голос с улицы", "text": "Шёпот."},
            ]}],
        )
        self.assertEqual(result["observations"], [])

    def test_long_dialogue_is_split_into_public_profile_sized_exact_quotes(self):
        source = "а" * 4_001
        result = adapt_upstream_result(
            source,
            {"characters": [{"name": "Лариса", "aliases": []}]},
            [{"segments": [{"speaker": "Лариса", "text": source}]}],
        )
        dialogue = [
            item for item in result["observations"]
            if item["type"] == "character_dialogue"
        ]
        self.assertEqual([len(item["evidence"]["quote"]) for item in dialogue], [4_000, 1])
        self.assertEqual("".join(item["evidence"]["quote"] for item in dialogue), source)

    def test_runtime_reuses_pipeline_isolated_content_cache(self):
        source = "Лариса: Привет."

        class FakeRuntime(AutiobookRuntime):
            phases = []

            def _run(self, phase: str, workdir: Path) -> str:
                self.phases.append(phase)
                if phase == "cast":
                    (workdir / "cast").mkdir(parents=True, exist_ok=True)
                    (workdir / "cast" / "characters.json").write_text(
                        json.dumps({"characters": [{"name": "Лариса", "aliases": []}]}),
                        encoding="utf-8",
                    )
                if phase == "script":
                    (workdir / "script").mkdir(parents=True, exist_ok=True)
                    (workdir / "script" / "01_Book.json").write_text(
                        json.dumps({"segments": [{"speaker": "Лариса", "text": "Привет."}]}),
                        encoding="utf-8",
                    )
                return "ok"

        with tempfile.TemporaryDirectory() as work_root:
            runtime = FakeRuntime(
                work_root=work_root,
                api_base="https://llm.example/v1",
                api_key="secret",
                model="test-model",
            )
            request = {
                "idempotencyKey": "run-1:external",
                "text": source,
                "sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
            }
            first = runtime.analyze(request)
            second = runtime.analyze({**request, "idempotencyKey": "run-2:external"})
            self.assertEqual(runtime.phases, ["cast", "script"])
            self.assertEqual(first, second)
            self.assertTrue((Path(work_root) / "external").is_dir())


if __name__ == "__main__":
    unittest.main()
