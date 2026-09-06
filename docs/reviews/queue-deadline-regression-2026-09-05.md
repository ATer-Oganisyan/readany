# LLM queue deadlines and abandoned internal POSTs

## Product result

Public chat requests no longer wait indefinitely for an occupied LLM slot.
Both JSON and streaming routes return `504 / TIMEOUT` when admission exceeds
`LLM_QUEUE_TIMEOUT_MS` (default 30 seconds; validated integer 1–120000 ms).
Expired queued work does not reach the provider. Already-admitted work is not
cancelled by this queue-only deadline and keeps its slot until its existing
`finally` releases it.

Internal generation still has a 10-minute deadline, now disposable, and also
cancels when a client disconnects after uploading a complete POST body. It no
longer relies solely on `req.aborted`, which misses that common disconnect path.

## Reproduction and acceptance

Before runtime edits, two actual HTTP regression tests failed:

1. A real isolated gateway process plus held local upstream admitted one request;
   the next public request did not produce a 504 within the test bound.
2. A real internal-generation router received a complete POST, then its client
   disconnected; its signal remained un-aborted and the queued item remained.

After the fixes, both pass. The public test checks both transports, zero extra
provider calls, empty waiting count, retained active count, and successful
completion of the original operation after the queue deadline has elapsed.
The internal test verifies queue removal without dispatching the abandoned work
or releasing the unrelated active slot.

Additional tests cover typed timeout errors, timer/parent-listener disposal,
pre-aborted requests, HTTP listener cleanup on successful completion and abort,
and rejection of invalid SLA configuration.

```sh
node --test services/narra-gateway/test/request-deadline.test.mjs \
  services/narra-gateway/test/queue-deadline-http.test.mjs \
  services/narra-gateway/test/concurrency.test.mjs \
  services/narra-gateway/test/workload-concurrency.test.mjs \
  services/narra-gateway/test/workload-concurrency-http.test.mjs \
  services/narra-gateway/test/internal-generation-service.test.mjs
```

Result: **62 passed, 0 failed, 0 skipped**. All HTTP traffic used own loopback
fixtures, synthetic credentials and isolated temporary data. No live AI,
external database or deployment was used. Temporary test data was removed by
the test teardown; no existing audit data was deleted.

## Scope and remaining risks

This is an admission deadline, not a total public end-to-end SLA. Existing
provider deadlines remain separate. A supplied AbortSignal cannot interrupt
arbitrary non-cooperative awaited promises. Hanging analytics/`onAttempt`
retaining an active slot was independently reproduced but is deliberately not
fixed in this batch; root owns the separate bounded analytics change.

The Expo Networking skill informed cancellation/error-path checks. No mobile
runtime, simulator, Metro configuration or native build was changed.
