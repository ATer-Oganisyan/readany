# Parallel book analysis v3

## Development baseline

`codex/book-markup-backend-ui` is the stable source-of-truth branch for the
Android and backend integration. Tag `Android.Backend.Stable.1` identifies the
baseline commit. Development of the parallel analysis pipeline is isolated on
`codex/parallel-book-analysis`.

The v2 generation queue and published markup remain untouched until v3 passes
shadow evaluation and is explicitly enabled.

## Pipeline invariant

Final markup and character profiles are created only after the complete book
has been scanned. A chunk worker never edits final markup. It appends grounded
observations containing an exact quote and offsets in the normalized source.

The pipeline stages are:

1. `prepare`: extract normalized text, chapter boundaries and stable chunks;
2. `scan`: process every chunk with independently scalable workers;
3. `resolve`: merge aliases and candidates into canonical entities;
4. `synthesize`: create parallel character profiles and assemble one result from a frozen whole-book evidence snapshot;
5. `validate`: verify evidence, offsets, references and schema;
6. `publish`: atomically publish the validated result to an isolated shadow channel.

Every stage has a durable barrier. A run can advance only when it has at least
one required job for the current stage and all required jobs are `ready`.

## Isolation and parallelism

The `book_analysis_*` tables form an independent control plane:

- `book_analysis_runs` owns one idempotent pipeline execution;
- `book_analysis_chunks` stores stable core and context boundaries;
- `book_analysis_jobs` provides stage-specific leases and retries;
- `book_analysis_observations` is an append-only evidence stream;
- `book_analysis_entities` stores canonical resolved entities;
- `book_analysis_snapshots` freezes the whole-book evidence input;
- `book_analysis_artifacts` stores immutable synthesis content and validation outputs;
- `book_analysis_publications` stores only independently validated shadow revisions.

Workers claim different jobs with `FOR UPDATE SKIP LOCKED`. A job is unique by
`run_id`, `stage` and `shard_key`, while scan observations are unique by run,
chunk, extractor version and observation key. Reclaiming an expired lease must
therefore repeat work safely without duplicating facts.

## Markup contract

`book-markup-v3` separates factual and creative character data. Factual claims
such as role, traits, appearance and speech style require one or more evidence
IDs and a confidence value. Character identity also requires evidence.

Greeting text, portrait prompts and voice selection live under `creative`.
They are generated from factual profiles but are never presented as facts from
the book.

The v3 control plane does not change public APIs or the mobile client. Its
publication is shadow-only and does not update the existing v2 markup tables.

## Prepare runtime

The coordinator creates one idempotent run and one `prepare` job. The prepare
worker verifies the immutable source checksum, extracts normalized text with
stable section offsets, stores that text at
`analysis/{runId}/normalized-text-v1.txt`, and creates all scan shards in the
same transaction that completes the prepare barrier.

Core chunk ranges cover the normalized text exactly once. Context ranges overlap
for model quality, but observations will be owned by the core range to avoid
duplicates. Chunk identity is deterministic for one run and binds its offsets
and content hash.

Run a prepare-only worker with:

```bash
npm run worker:book-analysis
```

The process is not part of the existing deployment profile and does not change
v2 until it is explicitly deployed and a run is created by the coordinator.

## Scan runtime

Each scan worker claims one chunk lease, reads only that chunk's UTF-8 byte
range from normalized storage and verifies its immutable content hash. The
generation service receives that bounded context plus its owned core range; it
does not receive the source object key or the complete normalized book.

The model returns candidate observations with local UTF-16 offsets. Before any
write, the worker verifies that every quote is an exact slice of the chunk,
converts offsets to the normalized book coordinate space and discards evidence
whose start belongs only to an overlap. Accepted observations are appended in
the same transaction that completes the scan job.

The final scan completion is a durable barrier: under a run lock it creates
exactly one `resolve` job and advances the run from `scan` to `resolve`. Multiple
processes may run the scan executable concurrently:

```bash
npm run worker:book-analysis-scan
```

## Resolve runtime

After every required scan shard is ready, one resolve job reads the complete,
ordered observation set. Resolution is deterministic and conservative: exact
normalized candidates are grouped, while only high-confidence
`character_alias` observations may connect different names. An alias claimed
for more than one canonical character is left separate instead of merging two
people. Pronouns and other weak one-off character labels remain candidates.

Every observation must be assigned to exactly one entity of the same kind.
Resolve completion rechecks a hash of the full observation set, stores entity
links and freezes the ordered observation IDs plus resolved entity data in
immutable snapshot version 1. Observation rows are themselves immutable, and a
database trigger rejects any new observation outside a running scan job. The
same transaction completes resolve, creates one `synthesize` job per confirmed
character plus a dependent book assembly job, and advances the run:

```bash
npm run worker:book-analysis-resolve
```

Multiple resolve processes can work on different books. A single book keeps
one resolve shard because identity decisions require the complete evidence set.
Final profiles, character traits and markup are still not produced at this
stage.

## Synthesize runtime

Character jobs can run concurrently across both books and characters. Each job
reads only evidence linked to its resolved character. A deterministic selector
keeps the model request bounded while retaining observations from the beginning,
middle and end of the book and preserving each available fact type. Identity is
not regenerated: the resulting profile is rebound to the frozen resolved entity.
The markup contract includes at most the first 128 confirmed characters by
first appearance.

The book assembly job cannot be claimed until every required character profile
is ready. It then joins the profiles, locations, events and relationships from
the same snapshot without another whole-book model request:

```bash
npm run worker:book-analysis-synthesize
```

Run multiple copies of this worker to parallelize profile formation.

## Validate and shadow publish runtime

Validation is a separate non-LLM stage. It rereads normalized text, verifies its
hash, exact evidence quotes and offsets, snapshot membership, entity ownership,
claim-to-observation type compatibility and all markup references. The report is
bound to the snapshot hash, source hash and markup artifact hash. Invalid markup
fails the run and never creates a publish job.

```bash
npm run worker:book-analysis-validate
```

The publish worker accepts only a valid bound report and writes an immutable
`shadow` publication. It intentionally does not touch v2 `book_markups` or make
v3 visible to readers:

```bash
npm run worker:book-analysis-publish
```
