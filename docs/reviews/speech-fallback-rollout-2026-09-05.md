# Speech-example recovery: version and rollout boundary

New Narra analysis uses `book-analysis-v52` and `character-profile-v15`.
The synthesis version separates generation-cache requests; the pipeline version
also separates durable run/publication identity for the same edition and source.
A synthesis-only bump would leave `ensureAnalysisRun` reusing a ready v51 run.
Scan v17, markup/schema v3 and the external pipeline remain unchanged.

Before deploying, drain old v51 jobs using their compatible workers. The new
worker deliberately rejects an old pipeline implementation instead of silently
processing it with new semantics. No compatibility rewrite or job migration is
included. Coordinate gateway/worker rollout so old queued or leased work is not
stranded.

Stored profiles and publications are not modified. No automatic bulk backfill,
database mutation, provider call or deployment was performed for this change.
A later explicit analysis/import completion or reimport can request the new
identity and incur a new paid analysis even for the same source. Do not describe
this change as free regeneration of existing books. Existing cache repair is a
separate decision, not an implicit background operation.

Behavioral regression compares actual run-key generation for identical source
under v51/v52, checks default strategy v52/v15, and confirms rejection of old
implementation dispatch. Two service tests exercising the *current* audit and
primary-timeline paths now use the current synthesis constant: leaving their
hardcoded v14 would exercise the legacy one-call path instead. Other explicitly
legacy fixtures are not mechanically rewritten.
