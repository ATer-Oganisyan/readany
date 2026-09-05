# One-shot Codex fixture bridge — QA only

This adapts a **contained coding agent**, not an inference-only API. It is not
for production, arbitrary books, public traffic or third-party prompts. Root
must inspect and approve the full request contents before approving their hashes.
No authentication files are read by this code; the official CLI resolves its
existing sign-in normally. Subscription limits are respected, not bypassed.

## Review state

- Real macOS `codex sandbox` synthetic command containment: 14 checks passed,
  including the exact trusted executable exception and unchanged outside denial.
- Actual HTTP server with fake child: 21 tests passed, no model requests.
- Actual CLI strict-config preflight: 2 tests passed with empty stdin/no turn.
- Real `codex exec` with the complete bridge flags: not exercised by this agent.
  Model-free `debug prompt-input` bootstrap with the scoped profile succeeds
  after granting read access to the exact canonical CLI executable and launching
  that canonical path, not its denied intermediate symlinks. No directory-wide
  auth/package read grant was added. Parent manages any subsequent live canary.
  A second startup blocker was the obsolete `tools.view_image` config key,
  rejected by this CLI's strict mode despite the documentation listing it.
  The bridge now uses `--disable view_image` only. Exact flags validate before
  the expected no-prompt exit in the model-free preflight.
- Whole-agent/in-process/hosted-tool containment: **not guaranteed**. Permissions
  govern local commands; separate disabled feature flags reduce other surfaces
  but are not a universal deny-all guarantee. Managed config and runtime version
  can affect the effective inventory. See the safety review in `docs/reviews`.

## Contract and hard bounds

The only route is authenticated `POST /v1/chat/completions`, bound to
`127.0.0.1` on an ephemeral port. Browser Origin requests are rejected; no CORS
headers are emitted. A new random 256-bit bearer token belongs to each instance.

Only exact UTF-8 body bytes whose SHA256 is pre-approved may spawn the CLI.
Whitespace and field order changes produce a different hash. Unknown bodies
receive `403 request_not_approved` with only their hash, never reflected content.
Approvals are 1–3 SHA256 strings supplied explicitly; the bridge does not approve
or mutate its own allowlist.

Supported request fields:

- `model`: exactly `gpt-5.6-luna`.
- `messages`: 1–16 plain `{role, content}` items; system/user/assistant roles.
- `stream`: absent or `false` only. `true` and non-booleans fail explicitly.
- `max_tokens`: optional integer 1–8000, **advisory only**. CLI receives the
  requested budget as a hint; this is not exact token-limit enforcement.

`tools`, `tool_choice`, `parallel_tool_calls`, streaming, sampling options and
unknown parameters return explicit 400 errors. The real backend's
`structured_task` request fits this subset. `character_chat` adds
`temperature: 0.85` plus `reasoning_effort: none` for `giga:gpt-5.6-luna` and
`litellm:openrouter/openai/gpt-5.6-luna`; those options are unsupported, not
silently dropped. The canary's `litellm:gpt-5.6-luna` pairing has no sampling
override. This bridge still cannot validate the full assistant or character tool
loop.

JSON success contains one assistant message and `finish_reason: stop`, only
after successful CLI exit and a `turn.completed` event. No token usage, realtime
streaming, exact chat-role equivalence or full OpenAI API compatibility is claimed.

Hard limits: one active child until process close; at most three CLI launches
per instance (caller may lower this); 45-second child deadline; 32 KiB request;
64 KiB combined stdout/stderr; 16 KiB assistant text; eight server connections.
Body reading has a five-second deadline. Deadlines, output overflow, disconnect
and bridge close terminate the detached child's process group. Recognized quota
events latch a stop for subsequent calls; this wrapper never retries. The launch
budget counts subprocess launches, not any internal CLI transport attempts.
`close()` awaits actual child close after signaling, with a 1.5-second reap
deadline; timeout throws rather than reporting successful cleanup. CLI failures
expose only exit code and a fixed diagnostic category, never raw stderr.

## Running after review

Prepare a private JSON file containing the SHA256 strings for independently
reviewed request bodies. Do not substitute unreviewed provider traffic.

```sh
node scripts/qa/codex-fixture-bridge.mjs --approval-file /absolute/path/approved-hashes.json
```

Startup prints only the loopback URL, token-file path and fixture path, never the
token. The token file is exclusively created with mode 0600 in a separate new
temp directory, outside the model-readable fixture root. It is not committed.
Stop with SIGTERM/SIGINT. Small temp directories are retained for inspection.
Do not point public/backend production traffic at this listener.

For staged per-request review, publish approvals atomically: after reviewing
the exact request and prior response, write a separate candidate file, set it
to0600, then hard-link it to the manifest's approval path without overwrite.
Do not create the watched approval path with0644 and chmod it later: the50ms
poller correctly rejects that intermediate unsafe state and stops permanently.
Only the external reviewer writes approvals; the controller never approves itself.
On failure the staged controller retains a private `failure.json` containing
fixed stage/category and `startedCalls` (bridge dispatch count, not proof of CLI
execution). It never persists raw errors or credentials there. Cleanup failures
remain outside this diagnostic; missing evidence does not mean zero model calls.

Programmatic `createFixtureBridge({approvedHashes, maxCalls: 1})` supports a
single controlled canary and returns `{url, token, cwd, close}`. Keep the token
in memory; do not log it. The test-only `spawnChild` injection is never exposed
as an HTTP field.

```sh
node --test scripts/qa/codex-fixture-bridge.test.mjs
node --test scripts/qa/codex-cli-preflight.test.mjs
node scripts/qa/codex-sandbox-probe.mjs
```

Neither command calls a model. Model-free tests cover admission, exact hashes,
unsupported fields, concurrency/budget, quota, deadlines, output bounds,
disconnect cleanup, malformed CLI output and split UTF-8 Russian text.

## Fixed character-dialogue HTTP checkpoint

`gateway-http-canary.mjs --character-chat` captures the real mounted Anna
own-story screen, then the real provider serializer, without calling a model.
Only the separately reviewed upstream SHA256
`9890b4c1a6b41bf86e7ca44ada198e012b3958c8fb81b791e805621aaacc6525`
is accepted. Changed prompts fail closed and require another review.
This reviewed revision adds explicit fact-versus-motive interpretation guidance;
historical artifacts retain the preceding `7d6447...` hash and original replies.

`--mock --character-chat` exercises actual isolated gateway registration and
HTTP completion with a fake child. `--live --character-chat` makes exactly one
contained CLI request through that gateway, without configuring the permanent
mobile gateway. Both modes await their owned process cleanup.

The mobile request, including temperature0.85, is sent unchanged to the gateway.
The selected `litellm:gpt-5.6-luna` pair has no sampling override in the current
server capability table; its upstream request contains only model, messages,
max_tokens512 and stream:false. This does **not** validate temperature0.85 or
reasoning_effort:none of other provider/model pairs. The CLI token cap remains
advisory. No sampling parameters are newly accepted or silently discarded by
the bridge itself.

Nonempty returned text establishes transport only. The result explicitly leaves
`qualityAccepted:false` until separate human/agent review of facts, first-person
voice, style and spoiler scope. This is one turn, not a native chat session,
stream/tools, generated profile, image, speech or full-book acceptance.
