#!/usr/bin/env python3
"""Build an auditable popularity index and a 500-book generation campaign.

The catalog itself is immutable input. Wikimedia page views are a frozen,
observable signal; the generated JSON keeps the selected pages and raw counts
so the ranking can be reviewed before it is loaded into PostgreSQL.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable


VERSION = "catalog-book-popularity-v1"
CAMPAIGN_VERSION = "book-generation-campaign-500-v1"
WIKIMEDIA_USER_AGENT = (
    "NarraBookPopularity/1.0 "
    "(https://github.com/ATer-Oganisyan/readany; catalog ranking research)"
)
LANGUAGE_SUFFIXES = {
    "ru": ("роман", "повесть", "пьеса", "поэма", "рассказ", "книга", "сказка"),
    "en": (
        "novel", "book", "play", "poem", "short story", "novella",
        "autobiography", "memoir", "essay", "fairy tale",
    ),
}
LITERARY_DESCRIPTION_TOKENS = {
    "ru": (
        "роман", "повест", "рассказ", "пьес", "поэм", "книг", "сказ",
        "произведен", "трагед", "комед", "сборник", "автобиограф", "мемуар",
        "трактат", "эссе", "эпос", "литератур",
    ),
    "en": (
        "novel", "novella", "book", "short story", "play", "poem", "fairy tale",
        "collection", "autobiograph", "memoir", "treatise", "essay", "epic",
        "tragedy", "comedy", "satire", "literary", "work by",
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--book-data", required=True, type=Path)
    parser.add_argument("--catalog-export", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--campaign-output", required=True, type=Path)
    parser.add_argument("--target-count", type=int, default=500)
    parser.add_argument("--portrait-count", type=int, default=50)
    parser.add_argument("--oversize-text-length", type=int, default=1_500_000)
    parser.add_argument("--popular-rank-limit", type=int, default=100)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--offline", action="store_true")
    return parser.parse_args()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for offset in range(0, len(values), size):
        yield values[offset : offset + size]


def cache_key(endpoint: str, params: dict[str, str]) -> str:
    canonical = endpoint + "?" + urllib.parse.urlencode(sorted(params.items()))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class WikimediaClient:
    def __init__(self, cache: dict[str, Any], cache_path: Path, offline: bool = False):
        self.cache = cache
        self.cache_path = cache_path
        self.offline = offline
        self.lock = threading.Lock()
        self.requests_since_checkpoint = 0

    def request(self, endpoint: str, params: dict[str, str]) -> dict[str, Any]:
        key = cache_key(endpoint, params)
        if key in self.cache:
            return self.cache[key]
        if self.offline:
            raise RuntimeError(f"missing offline cache entry: {key}")
        body = urllib.parse.urlencode(params).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=body,
            headers={
                "User-Agent": WIKIMEDIA_USER_AGENT,
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        last_error: Exception | None = None
        for attempt in range(12):
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    payload = json.loads(response.read())
                if "error" in payload:
                    raise ValueError(str(payload["error"]))
                with self.lock:
                    self.cache[key] = payload
                    self.requests_since_checkpoint += 1
                    if self.requests_since_checkpoint >= 20:
                        atomic_json(self.cache_path, self.cache)
                        self.requests_since_checkpoint = 0
                time.sleep(0.15)
                return payload
            except urllib.error.HTTPError as error:
                last_error = error
                if error.code != 429:
                    time.sleep(min(30.0, 0.5 * (2**attempt)))
                    continue
                retry_after = error.headers.get("Retry-After")
                delay = int(retry_after) if retry_after and retry_after.isdigit() else 30
                time.sleep(max(10, min(90, delay)))
            except (urllib.error.URLError, TimeoutError, RuntimeError) as error:
                last_error = error
                time.sleep(min(30.0, 0.5 * (2**attempt)))
        raise RuntimeError(f"Wikimedia request failed: {last_error}")


def normalized_source_key(catalog_key: str) -> str:
    value = re.sub(r"^narra-(?:ru|en)-\d+-", "", catalog_key)
    return re.sub(r"^eval-v\d+(?:-b\d+)?-", "", value)


def inferred_catalog_language(catalog_key: str) -> str | None:
    if catalog_key.startswith("narra-en-"):
        return "en"
    if catalog_key.startswith("narra-ru-") or catalog_key.startswith("eval-"):
        return "ru"
    return None


def title_base(title: str) -> str:
    value = re.split(r"\s*[:;]\s*", title.strip(), maxsplit=1)[0]
    return re.sub(r"\s+", " ", value).strip(" .")


def work_title_candidates(book: dict[str, Any]) -> list[tuple[str, str]]:
    # PageViewInfo rejects a few valid book titles containing literal quote
    # marks; Wikipedia page titles conventionally omit those surrounding marks.
    title = re.sub(r"\s+", " ", book["title"].replace('"', "")).strip(" “”")
    base = title_base(title)
    result: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add(value: str, kind: str) -> None:
        normalized = value.casefold()
        if value and normalized not in seen:
            seen.add(normalized)
            result.append((value, kind))

    add(title, "exact")
    add(base, "base")
    for suffix in LANGUAGE_SUFFIXES[book["language"]]:
        add(f"{base} ({suffix})", "typed")
    return result


def primary_author(author: str) -> str:
    value = re.sub(r"\s*\([^)]*\d{4}[^)]*\)\s*$", "", author).strip()
    value = re.split(r"\s*[;/]\s*", value, maxsplit=1)[0]
    value = re.split(
        r",\s*(?:илл\.?|пер\.?|ред\.?|illustrated|translated|edited)\b",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    return value.strip(" ,")


def response_pages(payload: dict[str, Any], requested: list[str]) -> dict[str, dict[str, Any]]:
    query = payload.get("query") or {}
    aliases: dict[str, str] = {value: value for value in requested}
    for item in query.get("normalized") or []:
        aliases[item["from"]] = item["to"]
    for item in query.get("redirects") or []:
        aliases[item["from"]] = item["to"]

    def resolved(value: str) -> str:
        seen: set[str] = set()
        while value in aliases and aliases[value] != value and value not in seen:
            seen.add(value)
            value = aliases[value]
        return value

    raw_pages = query.get("pages") or []
    pages = raw_pages.values() if isinstance(raw_pages, dict) else raw_pages
    by_title = {
        page.get("title", ""): page
        for page in pages
        if "missing" not in page
    }
    result: dict[str, dict[str, Any]] = {}
    for value in requested:
        page = by_title.get(resolved(value)) or by_title.get(value)
        if page:
            result[value] = page
    return result


def fetch_pages(
    client: WikimediaClient,
    language: str,
    titles: list[str],
    workers: int,
) -> dict[str, dict[str, Any]]:
    endpoint = f"https://{language}.wikipedia.org/w/api.php"
    def fetch(batch: list[str], prop: str) -> dict[str, dict[str, Any]]:
        try:
            payload = client.request(
                endpoint,
                {
                    "action": "query",
                    "format": "json",
                    "formatversion": "2",
                    "redirects": "1",
                    "prop": prop,
                    "titles": "|".join(batch),
                },
            )
            return response_pages(payload, batch)
        except ValueError as error:
            # One malformed or cached-error title must not discard the other
            # 1499 books. Bisect the batch and skip only the terminal offender.
            if len(batch) == 1:
                print(f"warning: skipped Wikimedia title {batch[0]!r}: {error}", file=sys.stderr)
                return {}
            middle = len(batch) // 2
            return {**fetch(batch[:middle], prop), **fetch(batch[middle:], prop)}

    def query(values: list[str], prop: str) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        batches = list(chunks(sorted(set(values), key=str.casefold), 50))
        with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
            pending = [executor.submit(fetch, batch, prop) for batch in batches]
            for future in as_completed(pending):
                result.update(future.result())
        return result

    # PageViewInfo can fail an entire request when even one requested title does
    # not exist. Resolve existence and redirects first, then ask for page views
    # only for canonical pages known to exist.
    existing = query(titles, "pageprops")
    canonical_titles = sorted({page["title"] for page in existing.values()}, key=str.casefold)
    detailed = query(canonical_titles, "pageviews|pageprops")
    return {
        requested: detailed.get(page["title"], page)
        for requested, page in existing.items()
    }


def page_views(page: dict[str, Any]) -> tuple[int, str | None, str | None]:
    values = page.get("pageviews") or {}
    dates = sorted(values)
    return sum(int(value or 0) for value in values.values()), dates[0] if dates else None, dates[-1] if dates else None


def normalized_title(value: str) -> str:
    value = re.sub(r"\s*\([^)]*\)\s*$", "", value)
    return re.sub(r"[^\w]+", " ", value.casefold()).strip()


def select_work_page(
    book: dict[str, Any],
    candidates: list[tuple[str, str]],
    pages: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    selected: list[tuple[float, int, dict[str, Any]]] = []
    base = normalized_title(title_base(book["title"]))
    for candidate, kind in candidates:
        page = pages.get(candidate)
        if not page or "disambiguation" in (page.get("pageprops") or {}):
            continue
        page_title = normalized_title(page.get("title", ""))
        similarity = SequenceMatcher(None, base, page_title).ratio() if base and page_title else 0.0
        if similarity < 0.58:
            continue
        description = str((page.get("pageprops") or {}).get("wikibase-shortdesc") or "")
        literary = any(
            token in description.casefold()
            for token in LITERARY_DESCRIPTION_TOKENS[book["language"]]
        )
        if description and not literary:
            continue
        if literary:
            confidence = 1.0 if kind in {"exact", "base"} else 0.97
        elif kind == "typed":
            confidence = 0.72
        else:
            confidence = 0.42
        confidence *= max(0.75, similarity)
        views, start, end = page_views(page)
        record = {
            "title": page["title"],
            "url": f"https://{book['language']}.wikipedia.org/wiki/" + urllib.parse.quote(page["title"].replace(" ", "_")),
            "wikidataId": (page.get("pageprops") or {}).get("wikibase_item"),
            "description": description or None,
            "views60d": views,
            "windowStart": start,
            "windowEnd": end,
            "matchConfidence": round(confidence, 4),
            "matchedCandidate": candidate,
        }
        selected.append((confidence, views, record))
    if not selected:
        return None
    selected.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return selected[0][2]


def select_author_page(author: str, page: dict[str, Any] | None, language: str) -> dict[str, Any] | None:
    if not page or "disambiguation" in (page.get("pageprops") or {}):
        return None
    views, start, end = page_views(page)
    return {
        "title": page["title"],
        "url": f"https://{language}.wikipedia.org/wiki/" + urllib.parse.quote(page["title"].replace(" ", "_")),
        "wikidataId": (page.get("pageprops") or {}).get("wikibase_item"),
        "views60d": views,
        "windowStart": start,
        "windowEnd": end,
        "matchedCandidate": author,
    }


def wikidata_claim_ids(entity: dict[str, Any], property_id: str) -> list[str]:
    result: list[str] = []
    for claim in (entity.get("claims") or {}).get(property_id) or []:
        value = (((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value") or {})
        if isinstance(value, dict) and isinstance(value.get("id"), str):
            result.append(value["id"])
    return result


def fetch_wikidata_metadata(
    client: WikimediaClient,
    qids: list[str],
    workers: int,
) -> dict[str, dict[str, Any]]:
    endpoint = "https://www.wikidata.org/w/api.php"
    batches = list(chunks(sorted(set(qids)), 50))

    def fetch(batch: list[str]) -> dict[str, dict[str, Any]]:
        payload = client.request(
            endpoint,
            {
                "action": "wbgetentities",
                "format": "json",
                "formatversion": "2",
                "ids": "|".join(batch),
                "props": "sitelinks|claims|descriptions",
                "languages": "ru|en",
            },
        )
        return {
            qid: {
                "sitelinks": len((entity or {}).get("sitelinks") or {}),
                "instanceOf": wikidata_claim_ids(entity or {}, "P31"),
                "authors": wikidata_claim_ids(entity or {}, "P50"),
                "descriptions": {
                    language: description.get("value")
                    for language, description in ((entity or {}).get("descriptions") or {}).items()
                    if isinstance(description, dict) and description.get("value")
                },
            }
            for qid, entity in (payload.get("entities") or {}).items()
        }

    result: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        pending = [executor.submit(fetch, batch) for batch in batches]
        for future in as_completed(pending):
            result.update(future.result())
    return result


def validated_work_page(
    work_page: dict[str, Any] | None,
    author_page: dict[str, Any] | None,
    language: str,
    wikidata: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any] | None, int]:
    if not work_page or not work_page.get("wikidataId"):
        return work_page, 0
    metadata = wikidata.get(work_page["wikidataId"]) or {}
    # These high-frequency false matches are never books: human, film,
    # television series, painting, or Wikimedia list article.
    disallowed_instances = {"Q5", "Q11424", "Q5398426", "Q3305213", "Q13406463"}
    if disallowed_instances.intersection(metadata.get("instanceOf") or []):
        return None, 0
    expected_author = (author_page or {}).get("wikidataId")
    claimed_authors = metadata.get("authors") or []
    if expected_author and claimed_authors and expected_author not in claimed_authors:
        return None, 0
    descriptions = metadata.get("descriptions") or {}
    description = descriptions.get(language) or descriptions.get("en")
    if description and not work_page.get("description"):
        work_page = {**work_page, "description": description}
    return work_page, int(metadata.get("sitelinks") or 0)


def popularity_score(work_page: dict[str, Any] | None, author_page: dict[str, Any] | None, sitelinks: int) -> float:
    work_views = int((work_page or {}).get("views60d") or 0)
    confidence = float((work_page or {}).get("matchConfidence") or 0)
    author_views = int((author_page or {}).get("views60d") or 0)
    return (
        0.75 * confidence * math.log1p(work_views)
        + 0.15 * math.log1p(author_views)
        + 0.10 * math.log1p(sitelinks)
    )


def bibliographic_identity(item: dict[str, Any]) -> str:
    title = normalized_title(title_base(item["title"]))
    title = re.sub(r"^(?:the|a|an)\s+", "", title)
    author = normalized_title(primary_author(item["author"]))
    return f"{item['language']}:{title}:{author}"


def load_catalog_rows(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    for row in rows:
        for name in (
            "source_byte_size", "text_length", "publication_count", "ready_portraits",
            "queued_portraits", "running_portraits", "failed_portraits",
        ):
            row[name] = int(row[name] or 0)
        row["cover_ready"] = row["cover_ready"] == "t"
    return rows


def bind_catalog_books(
    books: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    catalog_key_aliases: list[dict[str, Any]],
) -> dict[tuple[str, str], dict[str, Any]]:
    alias_source_keys = {
        alias["catalogKey"]: alias["sourceKey"]
        for alias in catalog_key_aliases
        if alias.get("sourceKey")
    }
    books_by_source_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for book in books:
        books_by_source_key[book["sourceKey"]].append(book)
    candidates: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        language = inferred_catalog_language(row["catalog_key"])
        source_key = alias_source_keys.get(
            row["catalog_key"], normalized_source_key(row["catalog_key"])
        )
        if language:
            candidates[(language, source_key)].append(row)
            continue
        # Three early catalog editions predate the narra-ru-* key convention.
        # Bind them only when both the canonical source key and title agree;
        # this deliberately excludes old evaluation aliases such as the
        # Russian edition stored under crime-and-punishment.
        exact_books = [
            book for book in books_by_source_key.get(source_key, [])
            if book["title"].casefold() == row["title"].casefold()
        ]
        if len(exact_books) == 1:
            candidates[(exact_books[0]["language"], source_key)].append(row)
    bindings: dict[tuple[str, str], dict[str, Any]] = {}
    for book in books:
        key = (book["language"], book["sourceKey"])
        matches = candidates.get(key) or []
        if len(matches) > 1:
            exact = [row for row in matches if row["title"].casefold() == book["title"].casefold()]
            matches = exact or matches
        if len(matches) != 1:
            raise RuntimeError(f"catalog binding is not unique for {key}: {len(matches)}")
        bindings[key] = matches[0]
    return bindings


def balanced_selection(
    ranked: dict[str, list[dict[str, Any]]],
    target_count: int,
) -> list[dict[str, Any]]:
    quotas = {"ru": target_count // 2, "en": target_count - target_count // 2}
    selected: list[dict[str, Any]] = []
    remaining: list[dict[str, Any]] = []
    for language in ("ru", "en"):
        candidates = [
            item for item in ranked[language]
            if item["canonicalEdition"]
            and not item["operational"]["published"]
            and not item["operational"]["oversize"]
        ]
        selected.extend(candidates[: quotas[language]])
        remaining.extend(candidates[quotas[language] :])
    if len(selected) < target_count:
        remaining.sort(
            key=lambda item: (-item["popularityIndex"], item["language"], item["sourceKey"])
        )
        selected.extend(remaining[: target_count - len(selected)])
    if len(selected) != target_count:
        raise RuntimeError(f"only {len(selected)} eligible unpublished books for target {target_count}")
    selected.sort(
        key=lambda item: (-item["popularityIndex"], item["language"], item["sourceKey"])
    )
    return selected


def main() -> int:
    args = parse_args()
    source = json.loads(args.book_data.read_text(encoding="utf-8"))
    books = source["books"]
    if len(books) != 1_500:
        raise RuntimeError("book data must contain exactly 1500 canonical catalog books")
    rows = load_catalog_rows(args.catalog_export)
    bindings = bind_catalog_books(books, rows, source.get("catalogKeyAliases") or [])
    cache = json.loads(args.cache.read_text(encoding="utf-8")) if args.cache.exists() else {}
    client = WikimediaClient(cache, args.cache, offline=args.offline)

    candidate_map: dict[tuple[str, str], list[tuple[str, str]]] = {}
    work_pages_by_language: dict[str, dict[str, dict[str, Any]]] = {}
    author_pages_by_language: dict[str, dict[str, dict[str, Any]]] = {}
    for language in ("ru", "en"):
        language_books = [book for book in books if book["language"] == language]
        all_work_titles: list[str] = []
        authors: list[str] = []
        for book in language_books:
            candidates = work_title_candidates(book)
            candidate_map[(language, book["sourceKey"])] = candidates
            all_work_titles.extend(candidate for candidate, _ in candidates)
            authors.append(primary_author(book["author"]))
        work_pages_by_language[language] = fetch_pages(
            client, language, all_work_titles, args.workers
        )
        author_pages_by_language[language] = fetch_pages(
            client, language, authors, args.workers
        )

    preliminary: list[dict[str, Any]] = []
    qids: list[str] = []
    window_dates: list[str] = []
    for book in books:
        key = (book["language"], book["sourceKey"])
        work_page = select_work_page(
            book,
            candidate_map[key],
            work_pages_by_language[book["language"]],
        )
        author = primary_author(book["author"])
        author_page = select_author_page(
            author,
            author_pages_by_language[book["language"]].get(author),
            book["language"],
        )
        if work_page and work_page.get("wikidataId"):
            qids.append(work_page["wikidataId"])
        if author_page and author_page.get("wikidataId"):
            qids.append(author_page["wikidataId"])
        for page in (work_page, author_page):
            if page and page.get("windowStart"):
                window_dates.extend([page["windowStart"], page["windowEnd"]])
        preliminary.append({"book": book, "workPage": work_page, "authorPage": author_page})

    wikidata = fetch_wikidata_metadata(client, qids, args.workers)
    atomic_json(args.cache, cache)

    ranked: dict[str, list[dict[str, Any]]] = {"ru": [], "en": []}
    for item in preliminary:
        book = item["book"]
        key = (book["language"], book["sourceKey"])
        row = bindings[key]
        work_page, sitelink_count = validated_work_page(
            item["workPage"], item["authorPage"], book["language"], wikidata
        )
        score = popularity_score(work_page, item["authorPage"], sitelink_count)
        operational = {
            "catalogKey": row["catalog_key"],
            "sourceByteSize": row["source_byte_size"],
            "textLength": row["text_length"],
            "published": row["publication_count"] > 0,
            "runStage": row["run_stage"] or None,
            "runStatus": row["run_status"] or None,
            "coverReady": row["cover_ready"],
            "readyPortraits": row["ready_portraits"],
            "oversize": row["text_length"] >= args.oversize_text_length,
        }
        ranked[book["language"]].append({
            "sourceKey": book["sourceKey"],
            "language": book["language"],
            "title": book["title"],
            "author": book["author"],
            "genres": book["genres"],
            "popularityScore": round(score, 8),
            "signals": {
                "workPage": work_page,
                "authorPage": item["authorPage"],
                "wikidataSitelinks": sitelink_count,
            },
            "operational": operational,
        })

    unique_work_counts: dict[str, int] = {}
    for language, items in ranked.items():
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in items:
            identity = bibliographic_identity(item)
            item["bibliographicIdentity"] = identity
            groups[identity].append(item)
        ordered_groups: list[tuple[float, str, list[dict[str, Any]]]] = []
        for identity, editions in groups.items():
            canonical = min(
                editions,
                key=lambda item: (
                    not item["operational"]["published"],
                    item["operational"]["textLength"] or sys.maxsize,
                    item["sourceKey"],
                ),
            )
            for edition in editions:
                edition["canonicalEdition"] = edition is canonical
                edition["duplicateOfSourceKey"] = None if edition is canonical else canonical["sourceKey"]
            ordered_groups.append((
                max(edition["popularityScore"] for edition in editions),
                identity,
                editions,
            ))
        ordered_groups.sort(key=lambda item: (-item[0], item[1]))
        total = len(ordered_groups)
        unique_work_counts[language] = total
        for index, (_, _, editions) in enumerate(ordered_groups, start=1):
            popularity_index = round(
                1_000_000 * (1 - ((index - 1) / max(1, total - 1)))
            )
            for edition in editions:
                edition["rankInLanguage"] = index
                edition["popularityIndex"] = popularity_index
        items.sort(key=lambda item: (
            item["rankInLanguage"], not item["canonicalEdition"], item["sourceKey"]
        ))

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    popularity_books = sorted(
        ranked["ru"] + ranked["en"],
        key=lambda item: (item["language"], item["rankInLanguage"]),
    )
    popularity = {
        "version": VERSION,
        "generatedAt": generated_at,
        "sourceCatalogVersion": source["version"],
        "method": {
            "primarySource": "Wikimedia Action API prop=pageviews",
            "secondarySource": "Wikidata sitelink counts",
            "pageviewWindowStart": min(window_dates) if window_dates else None,
            "pageviewWindowEnd": max(window_dates) if window_dates else None,
            "score": "0.75*match_confidence*ln(1+work_views)+0.15*ln(1+author_views)+0.10*ln(1+wikidata_sitelinks)",
            "popularityIndex": "language-local percentile from 1000000 (most popular) to 0",
            "caveat": "Popularity is an auditable discovery-order signal, not a literary-quality score.",
        },
        "counts": {
            "books": len(popularity_books),
            "ru": len(ranked["ru"]),
            "en": len(ranked["en"]),
            "uniqueWorksRu": unique_work_counts["ru"],
            "uniqueWorksEn": unique_work_counts["en"],
            "matchedWorkPages": sum(1 for item in popularity_books if item["signals"]["workPage"]),
        },
        "books": [{key: value for key, value in item.items() if key != "operational"} for item in popularity_books],
    }
    atomic_json(args.output, popularity)

    targets = balanced_selection(ranked, args.target_count)
    campaign_targets = []
    for campaign_rank, item in enumerate(targets, start=1):
        operational = item["operational"]
        campaign_targets.append({
            "campaignRank": campaign_rank,
            "priority": 1_001 - campaign_rank,
            "sourceKey": item["sourceKey"],
            "language": item["language"],
            "title": item["title"],
            "author": item["author"],
            "rankInLanguage": item["rankInLanguage"],
            "popularityIndex": item["popularityIndex"],
            **operational,
        })

    deferred = [
        item for language in ("ru", "en") for item in ranked[language]
        if item["canonicalEdition"]
        and item["rankInLanguage"] <= args.popular_rank_limit
        and item["operational"]["oversize"]
    ]
    deferred.sort(key=lambda item: (-item["popularityIndex"], item["language"], item["sourceKey"]))
    portrait_per_language = args.portrait_count // 2
    portrait_books: list[dict[str, Any]] = []
    for language in ("ru", "en"):
        eligible = [
            item for item in ranked[language]
            if item["canonicalEdition"] and not item["operational"]["oversize"]
        ]
        for item in eligible[:portrait_per_language]:
            portrait_books.append({
                "sourceKey": item["sourceKey"],
                "language": item["language"],
                "title": item["title"],
                "author": item["author"],
                "rankInLanguage": item["rankInLanguage"],
                "popularityIndex": item["popularityIndex"],
                **item["operational"],
            })
    portrait_books.sort(key=lambda item: (-item["popularityIndex"], item["language"], item["sourceKey"]))
    for index, item in enumerate(portrait_books, start=1):
        item["portraitCampaignRank"] = index

    missing_covers = [
        {
            "sourceKey": item["sourceKey"],
            "language": item["language"],
            "title": item["title"],
            "author": item["author"],
            "catalogKey": item["operational"]["catalogKey"],
        }
        for item in popularity_books
        if not item["operational"]["coverReady"]
    ]
    missing_covers.sort(key=lambda item: (item["language"], item["catalogKey"]))

    campaign = {
        "version": CAMPAIGN_VERSION,
        "generatedAt": generated_at,
        "popularityVersion": VERSION,
        "policy": {
            "targetCount": args.target_count,
            "initialLanguageQuota": {"ru": args.target_count // 2, "en": args.target_count - args.target_count // 2},
            "portraitCount": args.portrait_count,
            "portraitLanguageQuota": {"ru": portrait_per_language, "en": portrait_per_language},
            "oversizeTextLength": args.oversize_text_length,
            "popularRankLimit": args.popular_rank_limit,
            "selection": "unpublished, non-oversize books by language-local popularity; unused quota is filled by the other language",
        },
        "baseline": {
            "catalogBooks": len(books),
            "publishedBooks": sum(item["operational"]["published"] for item in popularity_books),
            "readyCovers": sum(item["operational"]["coverReady"] for item in popularity_books),
        },
        "targetLanguageCounts": {
            language: sum(item["language"] == language for item in campaign_targets)
            for language in ("ru", "en")
        },
        "targets": campaign_targets,
        "deferredPopularOversize": [
            {
                "sourceKey": item["sourceKey"],
                "language": item["language"],
                "title": item["title"],
                "author": item["author"],
                "rankInLanguage": item["rankInLanguage"],
                "popularityIndex": item["popularityIndex"],
                **item["operational"],
            }
            for item in deferred
        ],
        "portraitBooks": portrait_books,
        "missingCoversAtBaseline": missing_covers,
    }
    atomic_json(args.campaign_output, campaign)
    print(json.dumps({
        "popularityBooks": len(popularity_books),
        "workPageMatches": popularity["counts"]["matchedWorkPages"],
        "targets": len(campaign_targets),
        "targetLanguageCounts": campaign["targetLanguageCounts"],
        "deferredPopularOversize": len(deferred),
        "portraitBooks": len(portrait_books),
        "missingCoversAtBaseline": len(missing_covers),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise
