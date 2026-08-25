#!/usr/bin/env python3
"""Render safe SQL that prioritizes one analysis and portrait campaign.

The SQL updates only queued book_analysis_jobs belonging to catalog keys listed
in the reviewed campaign JSON, plus queued portraits for the reviewed top 50.
It never lowers priorities and can be re-applied as later jobs are created.
Failed covers are retried only behind an explicit command-line switch.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("campaign", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--retry-failed-covers",
        action="store_true",
        help="requeue only baseline-missing catalog covers that failed with HTTP 402",
    )
    return parser.parse_args()


def checked_catalog_keys(items: object, expected: int, label: str) -> list[str]:
    if not isinstance(items, list) or len(items) != expected:
        raise ValueError(f"campaign must contain exactly {expected} {label}")
    keys = [item.get("catalogKey") for item in items]
    if len(set(keys)) != expected or any(not isinstance(key, str) or not key for key in keys):
        raise ValueError(f"{label} catalog keys must be unique non-empty strings")
    return keys


def append_values(
    lines: list[str], table: str, columns: str, values: list[str], batch_size: int = 100
) -> None:
    for offset in range(0, len(values), batch_size):
        lines.append(f"INSERT INTO {table} ({columns}) VALUES")
        lines.append(",\n".join(values[offset : offset + batch_size]) + ";")


def render(campaign: dict, retry_failed_covers: bool = False) -> str:
    targets = campaign.get("targets")
    policy = campaign.get("policy") or {}
    expected = int(policy.get("targetCount") or 0)
    portrait_expected = int(policy.get("portraitCount") or 0)
    if campaign.get("version") != "book-generation-campaign-500-v1":
        raise ValueError("unsupported campaign version")
    if expected != 500 or portrait_expected != 50:
        raise ValueError("campaign policy must request 500 books and 50 portrait books")
    checked_catalog_keys(targets, expected, "generation targets")
    portrait_books = campaign.get("portraitBooks")
    checked_catalog_keys(portrait_books, portrait_expected, "portrait books")
    missing_covers = campaign.get("missingCoversAtBaseline")
    baseline = campaign.get("baseline") or {}
    missing_cover_expected = int(baseline.get("catalogBooks") or 0) - int(baseline.get("readyCovers") or 0)
    checked_catalog_keys(missing_covers, missing_cover_expected, "baseline-missing covers")
    priorities = [target.get("priority") for target in targets]
    if any(not isinstance(priority, int) or priority < -1000 or priority > 1000 for priority in priorities):
        raise ValueError("campaign priorities must be integers from -1000 to 1000")

    lines = [
        "\\set ON_ERROR_STOP on",
        "BEGIN;",
        "CREATE TEMP TABLE campaign_targets (",
        "  catalog_key text PRIMARY KEY,",
        "  campaign_rank integer NOT NULL UNIQUE,",
        "  priority integer NOT NULL CHECK (priority BETWEEN -1000 AND 1000)",
        ") ON COMMIT DROP;",
        "CREATE TEMP TABLE portrait_targets (",
        "  catalog_key text PRIMARY KEY,",
        "  portrait_rank integer NOT NULL UNIQUE CHECK (portrait_rank BETWEEN 1 AND 50)",
        ") ON COMMIT DROP;",
        "CREATE TEMP TABLE missing_cover_targets (catalog_key text PRIMARY KEY) ON COMMIT DROP;",
    ]
    append_values(
        lines,
        "campaign_targets",
        "catalog_key, campaign_rank, priority",
        [
            f"  ({literal(target['catalogKey'])}, {int(target['campaignRank'])}, {int(target['priority'])})"
            for target in targets
        ],
    )
    append_values(
        lines,
        "portrait_targets",
        "catalog_key, portrait_rank",
        [
            f"  ({literal(book['catalogKey'])}, {int(book['portraitCampaignRank'])})"
            for book in portrait_books
        ],
    )
    append_values(
        lines,
        "missing_cover_targets",
        "catalog_key",
        [f"  ({literal(book['catalogKey'])})" for book in missing_covers],
    )

    lines.extend([
        "DO $$",
        "DECLARE",
        "  target_count integer;",
        "  edition_count integer;",
        "  run_count integer;",
        "  portrait_count integer;",
        "  portrait_edition_count integer;",
        "  missing_cover_count integer;",
        "  missing_cover_edition_count integer;",
        "BEGIN",
        "  SELECT count(*) INTO target_count FROM campaign_targets;",
        "  SELECT count(*) INTO edition_count",
        "  FROM campaign_targets target",
        "  JOIN book_editions edition",
        "    ON edition.catalog_key = target.catalog_key AND edition.scope = 'catalog';",
        "  SELECT count(*) INTO run_count",
        "  FROM campaign_targets target",
        "  JOIN book_editions edition ON edition.catalog_key = target.catalog_key",
        "  JOIN book_analysis_runs run ON run.book_edition_id = edition.id",
        "  WHERE run.pipeline_version = 'book-analysis-v49'",
        "    AND run.prompt_version = 'book-scan-v17';",
        "  SELECT count(*) INTO portrait_count FROM portrait_targets;",
        "  SELECT count(*) INTO portrait_edition_count",
        "  FROM portrait_targets target",
        "  JOIN book_editions edition",
        "    ON edition.catalog_key = target.catalog_key AND edition.scope = 'catalog';",
        "  SELECT count(*) INTO missing_cover_count FROM missing_cover_targets;",
        "  SELECT count(*) INTO missing_cover_edition_count",
        "  FROM missing_cover_targets target",
        "  JOIN book_editions edition",
        "    ON edition.catalog_key = target.catalog_key AND edition.scope = 'catalog';",
        "  IF target_count <> 500 OR edition_count <> target_count OR run_count <> target_count",
        "     OR portrait_count <> 50 OR portrait_edition_count <> portrait_count",
        "     OR missing_cover_edition_count <> missing_cover_count THEN",
        "    RAISE EXCEPTION 'campaign binding failed: targets %, editions %, current runs %',",
        "      target_count, edition_count, run_count;",
        "  END IF;",
        "END $$;",
        "",
        "WITH prioritized AS (",
        "  UPDATE book_analysis_jobs job",
        "  SET priority = GREATEST(job.priority, target.priority), updated_at = now()",
        "  FROM campaign_targets target",
        "  JOIN book_editions edition ON edition.catalog_key = target.catalog_key",
        "  JOIN book_analysis_runs run",
        "    ON run.book_edition_id = edition.id",
        "   AND run.pipeline_version = 'book-analysis-v49'",
        "   AND run.prompt_version = 'book-scan-v17'",
        "  WHERE job.run_id = run.id AND job.status = 'queued'",
        "  RETURNING job.id, job.stage",
        ")",
        "SELECT stage, count(*) AS prioritized_jobs",
        "FROM prioritized",
        "GROUP BY stage",
        "ORDER BY stage;",
        "",
        "WITH prioritized_portraits AS (",
        "  UPDATE generation_jobs job",
        "  SET priority = GREATEST(job.priority, 1001 - target.portrait_rank), updated_at = now()",
        "  FROM portrait_targets target",
        "  JOIN book_editions edition ON edition.catalog_key = target.catalog_key",
        "  WHERE job.book_edition_id = edition.id",
        "    AND job.job_type = 'character_portrait'",
        "    AND job.status = 'queued'",
        "  RETURNING job.id",
        ")",
        "SELECT count(*) AS prioritized_portrait_jobs FROM prioritized_portraits;",
        "",
    ])
    if retry_failed_covers:
        lines.extend([
            "WITH retried_covers AS (",
            "  UPDATE generation_jobs job",
            "  SET status = 'queued', attempts = 0, last_error_code = NULL,",
            "      available_at = now(), priority = GREATEST(job.priority, 1000),",
            "      locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()",
            "  FROM missing_cover_targets target",
            "  JOIN book_editions edition ON edition.catalog_key = target.catalog_key",
            "  WHERE job.book_edition_id = edition.id",
            "    AND job.job_type = 'catalog_cover'",
            "    AND job.target_version = 'catalog-cover-v3'",
            "    AND job.status = 'failed'",
            "    AND job.last_error_code = 'GENERATOR_HTTP_402'",
            "    AND NOT EXISTS (",
            "      SELECT 1 FROM catalog_book_covers cover",
            "      WHERE cover.book_edition_id = edition.id AND cover.status = 'ready'",
            "    )",
            "  RETURNING job.id",
            ")",
            "SELECT count(*) AS retried_cover_jobs FROM retried_covers;",
            "",
        ])
    lines.extend(["COMMIT;", ""])
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    campaign = json.loads(args.campaign.read_text(encoding="utf-8"))
    sql = render(campaign, retry_failed_covers=args.retry_failed_covers)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(sql, encoding="utf-8")
    else:
        print(sql, end="")


if __name__ == "__main__":
    main()
