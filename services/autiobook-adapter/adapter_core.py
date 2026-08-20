"""Deterministic evidence boundary between autiobook and Narra."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Iterable


CONTRACT_VERSION = "autiobook-adapter-v1"
PROVIDER = "autiobook"
PROVIDER_VERSION = "d532bdd0a15f2948fd0c99f5e11b92677cb5c3eb"
EXTRACTOR_VERSION = CONTRACT_VERSION
MAX_QUOTE_UTF16 = 4_000
MAX_ENTITY_LENGTH = 512
ALIAS_WINDOW_CODEPOINTS = 512

_NON_IDENTITY = re.compile(r"[^\w]+", re.UNICODE)
_IMPERSONAL = re.compile(r"^голоса?(?:\s|$)", re.IGNORECASE)
_SYNTHETIC_SPEAKERS = {
    "narrator",
    "retained",
    "unvoiced",
    "silent",
    "extra female",
    "extra male",
    "extras",
}


class AdapterInputError(ValueError):
    """The caller violated autiobook-adapter-v1."""


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def utf16_offset(value: str, codepoint_offset: int) -> int:
    """Convert a Python code-point index to a JavaScript UTF-16 offset."""
    return len(value[:codepoint_offset].encode("utf-16-le")) // 2


def normalize_identity(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    normalized = normalized.replace("ё", "е").replace("_", " ")
    return " ".join(_NON_IDENTITY.sub(" ", normalized).split())


def is_non_character_speaker(value: Any) -> bool:
    normalized = normalize_identity(value)
    return normalized in _SYNTHETIC_SPEAKERS or bool(_IMPERSONAL.match(normalized))


def validate_request(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise AdapterInputError("request must be an object")
    if payload.get("contractVersion") != CONTRACT_VERSION:
        raise AdapterInputError(f"contractVersion must be {CONTRACT_VERSION}")
    idempotency_key = payload.get("idempotencyKey")
    if not isinstance(idempotency_key, str) or not idempotency_key.strip():
        raise AdapterInputError("idempotencyKey must be non-empty text")
    if len(idempotency_key) > 256:
        raise AdapterInputError("idempotencyKey exceeds 256 characters")
    source = payload.get("source")
    if not isinstance(source, dict):
        raise AdapterInputError("source must be an object")
    text = source.get("text")
    expected_hash = source.get("sha256")
    if not isinstance(text, str) or not text:
        raise AdapterInputError("source.text must be non-empty text")
    if len(text) > 33_554_432:
        raise AdapterInputError("source.text exceeds 33554432 characters")
    if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
        raise AdapterInputError("source.sha256 must be a lowercase SHA-256")
    if sha256_text(text) != expected_hash:
        raise AdapterInputError("source.sha256 does not match source.text UTF-8 bytes")
    return {
        "idempotencyKey": idempotency_key.strip(),
        "text": text,
        "sha256": expected_hash,
    }


@dataclass(frozen=True)
class Character:
    name: str
    aliases: tuple[str, ...]


def _cast_characters(cast: dict[str, Any]) -> list[Character]:
    result = []
    for raw in cast.get("characters", []):
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name or len(name) > MAX_ENTITY_LENGTH or is_non_character_speaker(name):
            continue
        aliases = tuple(
            dict.fromkeys(
                str(value).strip()
                for value in (raw.get("aliases") or [])
                if str(value).strip()
                and len(str(value).strip()) <= MAX_ENTITY_LENGTH
                and str(value).strip() != name
            )
        )
        result.append(Character(name=name, aliases=aliases))
    return result


def _speaker_map(characters: Iterable[Character]) -> dict[str, Character]:
    candidates: dict[str, list[Character]] = {}
    for character in characters:
        for form in (character.name, *character.aliases):
            key = normalize_identity(form)
            if key:
                candidates.setdefault(key, []).append(character)
    return {
        key: owners[0]
        for key, owners in candidates.items()
        if len({owner.name for owner in owners}) == 1
    }


def _observation_key(value: dict[str, Any]) -> str:
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"obs:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:48]}"


def _split_exact_ranges(source: str, start: int, end: int) -> Iterable[tuple[int, int]]:
    cursor = start
    while cursor < end:
        upper = min(end, cursor + MAX_QUOTE_UTF16)
        while upper > cursor and utf16_offset(source[cursor:upper], upper - cursor) > MAX_QUOTE_UTF16:
            upper -= 1
        if upper <= cursor:
            raise RuntimeError("unable to split exact quote on a UTF-16 boundary")
        yield cursor, upper
        cursor = upper


def _dialogue_observation(
    source: str,
    character: Character,
    start: int,
    end: int,
) -> dict[str, Any]:
    evidence = {
        "quote": source[start:end],
        "startOffset": utf16_offset(source, start),
        "endOffset": utf16_offset(source, end),
        "offsetEncoding": "utf-16",
    }
    identity = {
        "type": "character_dialogue",
        "entityCandidate": character.name,
        "quote": evidence["quote"],
        "startOffset": evidence["startOffset"],
        "endOffset": evidence["endOffset"],
    }
    return {
        "observationKey": _observation_key(identity),
        "type": "character_dialogue",
        "entityKind": "character",
        "entityCandidate": character.name,
        "relatedEntityCandidates": [],
        "fact": f"Реплика персонажа {character.name}.",
        "evidence": evidence,
        "confidence": 0.99,
    }


def _nearest_exact_occurrence(source: str, needle: str, anchor: int) -> tuple[int, int] | None:
    lower = max(0, anchor - ALIAS_WINDOW_CODEPOINTS)
    upper = min(len(source), anchor + ALIAS_WINDOW_CODEPOINTS)
    positions = []
    cursor = lower
    while True:
        position = source.find(needle, cursor, upper)
        if position < 0:
            break
        positions.append(position)
        cursor = position + max(1, len(needle))
    if not positions:
        return None
    start = min(positions, key=lambda value: (abs(value - anchor), value))
    return start, start + len(needle)


def _alias_observations(
    source: str,
    used: dict[str, tuple[Character, int]],
) -> Iterable[dict[str, Any]]:
    for character, anchor in sorted(used.values(), key=lambda item: (item[1], item[0].name)):
        for alias in character.aliases:
            occurrence = _nearest_exact_occurrence(source, alias, anchor)
            if occurrence is None:
                continue
            start, end = occurrence
            evidence = {
                "quote": source[start:end],
                "startOffset": utf16_offset(source, start),
                "endOffset": utf16_offset(source, end),
                "offsetEncoding": "utf-16",
            }
            identity = {
                "type": "character_alias",
                "entityCandidate": character.name,
                "alias": alias,
                "startOffset": evidence["startOffset"],
                "endOffset": evidence["endOffset"],
            }
            yield {
                "observationKey": _observation_key(identity),
                "type": "character_alias",
                "entityKind": "character",
                "entityCandidate": character.name,
                "relatedEntityCandidates": [alias],
                "fact": f"{character.name} также упоминается как {alias}.",
                "evidence": evidence,
                "confidence": 0.92,
            }


def adapt_upstream_result(
    source: str,
    cast: dict[str, Any],
    scripts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Align upstream output and return only exact, contract-safe observations."""
    characters = _cast_characters(cast)
    speakers = _speaker_map(characters)
    cursor = 0
    aligned_segments = 0
    dropped_segments = 0
    unmapped_speakers = 0
    exact_dialogue_segments = 0
    observations: list[dict[str, Any]] = []
    used: dict[str, tuple[Character, int]] = {}

    for script in scripts:
        for raw in script.get("segments", []):
            text = str(raw.get("text") or "") if isinstance(raw, dict) else ""
            speaker = str(raw.get("speaker") or "") if isinstance(raw, dict) else ""
            if not text:
                dropped_segments += 1
                continue
            start = source.find(text, cursor)
            if start < 0:
                dropped_segments += 1
                continue
            end = start + len(text)
            cursor = end
            aligned_segments += 1
            character = speakers.get(normalize_identity(speaker))
            if character is None:
                if not is_non_character_speaker(speaker):
                    unmapped_speakers += 1
                continue
            emitted = False
            for quote_start, quote_end in _split_exact_ranges(source, start, end):
                if source[quote_start:quote_end].strip():
                    observations.append(
                        _dialogue_observation(source, character, quote_start, quote_end)
                    )
                    emitted = True
            if emitted:
                exact_dialogue_segments += 1
                used.setdefault(character.name, (character, start))
            else:
                dropped_segments += 1

    aliases = list(_alias_observations(source, used))
    observations.extend(aliases)
    unique = {item["observationKey"]: item for item in observations}
    ordered = sorted(
        unique.values(),
        key=lambda item: (
            item["evidence"]["startOffset"],
            item["evidence"]["endOffset"],
            item["observationKey"],
        ),
    )
    return {
        "observations": ordered,
        "diagnostics": {
            "rawCharacters": len(cast.get("characters", [])),
            "usedCharacters": len(used),
            "alignedSegments": aligned_segments,
            "exactDialogueSegments": exact_dialogue_segments,
            "droppedSegments": dropped_segments,
            "unmappedSpeakers": unmapped_speakers,
            "groundedAliases": len(aliases),
        },
    }
