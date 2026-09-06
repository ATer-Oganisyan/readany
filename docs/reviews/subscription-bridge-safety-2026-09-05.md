# Local Codex text bridge: safety gate not accepted

Date: 2026-09-05. Scope: local QA only; no production integration.

## Outcome

No HTTP bridge or live generation was started. The installed `codex-cli 0.153.3`
has not been shown to provide the required enforceable **no tool execution**
boundary. This is an unmet acceptance criterion, not a claim that every possible
Codex integration is unsafe.

Parent reports a successful `gpt-5.6-luna` CLI probe after a subscription limit
reset. This agent did not repeat it. A previous quota failure and later successful
probe concern service availability, not isolation: neither proves that an
agent-backed HTTP endpoint has an inference-only execution boundary. Current
subscription capacity was not measured by this review.

## Evidence

- Read-only local checks: `codex --version`, `codex exec --help`,
  `codex features list`, `codex debug prompt-input --help`.
- `exec` supports `--ignore-user-config`, `--ephemeral`, read-only sandbox,
  JSON events and output schemas, but its help has no universal tools-none option.
- The [official configuration reference](https://developers.openai.com/codex/config-reference)
  documents individual shell, app, agent and web-search controls. A complete
  deny-all tool boundary was not established from those controls.
- Installed feature listing marks `apply_patch_freeform` as removed; disabling
  that old feature must not be treated as disabling the current patch tool.
- The [official hooks coverage documentation](https://learn.chatgpt.com/docs/hooks#tool-coverage)
  says hosted tools bypass local tool hooks and specialized paths can opt out.
  It explicitly does not position hooks as a complete enforcement boundary.
- Read-only command sandboxing is not no-tools operation. A prompt asking the
  model not to use tools and killing the child after observing an event are also
  insufficient prevention mechanisms.

No Codex authentication files/tokens were read or copied. No app profile,
provider configuration, gateway process, Metro or native installation changed.

## Bounded alternative review: official app-server / OS isolation

The [official app-server API](https://developers.openai.com/codex/app-server)
supports structured turn output, per-turn read-only restricted readable roots,
and client responses to command/file permission requests. Experimental
`dynamicTools` exposes client-owned tool calls through `item/tool/call`.
This is useful for retaining backend-owned application tools, but the documented
field is not a replacement/allowlist for all built-in tools: the docs explicitly
distinguish reserved built-in tool namespaces. An empty dynamic list therefore
does not establish an empty agent tool registry.

Rejecting every approval request is likewise not a universal interception point:
the documentation says actions *may* require approval depending on settings.
An integration must also never expose `thread/shellCommand` or `process/spawn`
to an untrusted HTTP caller; these explicitly run outside the thread sandbox.

The supported `externalSandbox` policy allows a caller-managed OS/container
boundary around the server process. This can contain an agent but does not itself
turn it into a tool-free inference endpoint. The [official security guide](https://learn.chatgpt.com/docs/agent-approvals-security)
describes command sandboxing separately from app/MCP behavior. A disposable
isolation design would need verified host filesystem exclusion, network controls,
official authentication inside that environment without credential extraction,
and a reviewed tool/hosted-action policy. No such environment was created here.

Conclusion: app-server is a plausible integration surface for further supported
design, but the reviewed documentation does not yet establish the requested
inference-only boundary. Do not infer impossibility of the broader task. The next
decision is either obtain a supported deny-all/allowlist guarantee for the pinned
runtime, or explicitly accept a separately reviewed contained-agent design with
different acceptance criteria. No workaround was attempted.

## Conditions for implementation

1. Establish a supported, verifiable empty-tool registry or a complete pre-execution
   enforcement boundary for the pinned CLI version. A fake-child test alone
   cannot establish that real CLI property.
2. Then implement loopback binding, random local bearer authorization, no CORS,
   argument-array process spawning, isolated working directory, ignored user
   config, strict size/time/concurrency/request budgets and process-tree cleanup.
3. Test actual HTTP requests against controlled children: authentication,
   unsupported fields, disconnects, deadlines, overflow, quota circuit breaking,
   JSON output and buffered SSE termination/error behavior. Do not claim realtime
   streaming when output is buffered.
4. Preserve the application's tool-call contract. Either reject `tools`,
   `tool_choice` and `parallel_tool_calls` explicitly with HTTP 400, or represent
   validated function calls as structured data for the existing backend to
   execute. Never silently drop them or execute them through Codex.
5. Obtain parent safety acceptance before any live model call. Live text proof
   would still not validate speech, images, production capacity or release readiness.

## Follow-up: contained fixture-only agent (different acceptance target)

The revised target permits an agent operating on predetermined QA fixtures; it
does not require a universally empty tool registry. This has a supported
building block: [Codex permission profiles](https://learn.chatgpt.com/docs/permissions)
restrict **local sandboxed commands** on macOS with Seatbelt. Unsupported
policies refuse execution rather than falling back to unsandboxed execution.
The docs separately exempt Codex model/authentication traffic from command
network policy, so normal CLI sign-in need not be extracted into the bridge.

Illustrative profile, **not installed as a bridge profile** (model-free command
containment was subsequently probed below):

```toml
default_permissions = "narra-fixture"
approval_policy = "never"
allow_login_shell = false
web_search = "disabled"

[shell_environment_policy]
inherit = "none"

[permissions.narra-fixture.filesystem]
":root" = "deny"
":minimal" = "read"
# Replace with the canonical, newly-created fixture directory only.
"/private/tmp/narra-fixture-EXAMPLE" = "read"
# Defense in depth; never grant these paths through another more-specific rule.
"/Users/tsevdnkanduev/.codex" = "deny"
"/Users/tsevdnkanduev/Narra" = "deny"

[permissions.narra-fixture.network]
enabled = false
```

Do not extend `:read-only` or `:workspace` here: that risks inheriting broader
read roots or writable temp directories. `:minimal` intentionally permits
platform runtime files and is not literally fixture-only filesystem access.
Exact paths avoid portable deny-glob expansion issues. Do not grant `:tmpdir`,
`:slash_tmp`, sockets or extra workspace roots.

Critical configuration trap: the official docs say **any loaded legacy
`sandbox_mode` or CLI `--sandbox` overrides `default_permissions`**. A bridge
must use `--ignore-user-config`, an isolated cwd and strict validated overrides,
without `--sandbox`, then verify the effective profile. `approval_policy=never`
does not mean deny every ordinary command; it prevents escalation prompts while
the selected sandbox supplies the actual restriction.

Additional controls are necessary, not optional:

- Disable apps, plugins, MCP servers, browser/Computer Use, multi-agent spawning,
  hooks, skill auto-install and other unrelated execution surfaces for this run.
  Command profiles do not sandbox these capabilities. Verify effective inventory,
  not just requested flags; inherited system/managed configuration must be checked
  without logging credentials or full user configuration.
- Disable local image reading for text QA. Enabling image generation later is a
  separate scoped capability decision: the reviewed profile docs do not establish
  filesystem/side-effect enforcement for every in-process or hosted image path.
- Inherit no tool environment, and pass only an allowlisted minimal environment
  to the CLI parent. The CLI can use its official auth storage normally; commands
  must neither read that storage nor inherit tokens. No token extraction/copying.
- Accept only fixed fixture IDs or hashes and bounded known templates, never a
  general public prompt proxy. Loopback plus random bearer token alone does not
  restrict input provenance. Limit request count, deadline, output and child life.

### Remaining concrete acceptance checks

The installed CLI exposes `codex sandbox --permission-profile NAME -C DIR`, so
the first check can be **model-free**: run harmless commands on synthetic
sentinels to verify inside reads succeed, outside reads and writes fail, fixture
symlinks cannot reach an outside sentinel, direct loopback networking and Unix
sockets fail, and no environment sentinel reaches the tool. Do not test by
reading real credentials. Also verify parent/child cleanup on deadline and the
effective loaded profile. The subsequent model-free probe below covers basic
filesystem/network/environment restrictions, not bridge lifecycle behavior.

The documented profile schema contains no general process-execution or
process-signal deny field. It permits contained commands; it is not a documented
complete process/IPC isolation policy for every tool runtime. If guaranteed
host-process isolation is required, use a separately reviewed OS/VM-contained
runner with official login inside it. `externalSandbox` means the caller supplies
that boundary; it does not create one automatically. Do not wrap the entire CLI
in an invented Seatbelt policy and claim ordinary auth still works without tests.

Verdict: a restricted, fixture-only **command** workflow has official support and
is a reasonable next validation target. Whole-agent containment still needs
effective capability inventory and non-command tool review before exposing an
HTTP bridge. This is narrower and more actionable than the original no-tools
blocker; neither safety nor impossibility of the broader bridge is asserted.

### Actual model-free probe: 13/13 PASS

Executed `node scripts/qa/codex-sandbox-probe.mjs` against installed
`codex-cli 0.153.3` on macOS. Each sandbox invocation uses argument-array spawning:

```text
codex sandbox -P narra-probe -C <canonical-new-fixture-directory>
  -c 'permissions.narra-probe.filesystem={ ":root"="deny", ":minimal"="read", "<fixture>"="read" }'
  -c 'permissions.narra-probe.network.enabled=false'
  -c 'approval_policy="never"'
  -c 'shell_environment_policy.inherit="none"'
  -- <fixed-test-command> <fixed-test-arguments>
```

No user/global configuration was edited. The helper resolves its normal config
stack; the test supplies an explicit permission profile through inline overrides.
This does not independently prove which config `codex exec --ignore-user-config`
will load in a future bridge. No real credentials were opened, and no model call
or authentication extraction was performed.

| Probe | Actual outcome |
| --- | --- |
| Unsandboxed synthetic outside-file control | Read succeeds, exit 0 |
| Fixture read | Exact expected sentinel, exit 0 |
| Sibling outside-file read | Permission denial, exit 1; sentinel not returned |
| Fixture symlink pointing to outside-file | Permission denial, exit 1; sentinel not returned |
| Write inside read-only fixture | Permission denial, exit 1 |
| Write outside fixture | Permission denial, exit 1 |
| Own loopback HTTP control | Request succeeds, exit 0 |
| Sandboxed loopback HTTP | curl exit 7; own server sees no additional request |
| Own Unix socket HTTP control | Request succeeds, exit 0 |
| Sandboxed Unix socket HTTP | curl exit 7; own server sees no additional request |
| Ordinary child environment control | Harmless marker is present, exit 0 |
| Sandboxed non-secret environment marker | Marker absent, exit 0 |
| Sandboxed synthetic secret-named marker | Marker absent, exit 0 |

The last run retained only synthetic files under
`/private/var/folders/s5/c9slzsgj5_dbzvp02cv3569r0000gn/T/narra-sandbox-probe-gpqZBP`;
an earlier 11-check run used sibling `narra-sandbox-probe-pspYqu`.
Own HTTP/socket servers were closed; no persistent worker was launched. The
harness retains tiny fixtures for inspection and prints no environment contents.

These are real OS-backed command results, not source-text assertions. They do
not validate every built-in/non-command tool, image generation, hosted actions,
host-process signaling, full child-tree termination, or adversarial whole-agent
isolation. No claim of release readiness or bridge acceptance follows from them.

### Fixture bridge implementation and subsequent startup regressions

The revised fixture-only target is implemented in
`scripts/qa/codex-fixture-bridge.mjs`, with its explicit limited contract in the
sibling Markdown file. This agent did not run live generations. Parent reported
two immediate live-canary startup failures and stopped retries pending fixes.

Model-free diagnosis established two separate issues:

1. The CLI bootstraps its own executable inside the command sandbox. The
   symlink launcher was denied. Launching the canonical executable and granting
   read access to **that exact file only** fixes executable bootstrap; no
   executable-directory, account-directory or repository-wide grant was added.
   `debug prompt-input` then completed with exit 0 / no stderr from a fixture cwd.
2. That diagnostic command does not support `--strict-config` and therefore did
   not validate the exact exec strictness. The installed CLI rejects the obsolete
   `tools.view_image=false` key in strict mode. Removing that key while retaining
   `--disable view_image` fixes configuration validation. The actual exact-flags
   preflight now uses empty stdin, so it terminates at the expected no-prompt
   condition without starting a model turn. The obsolete-key negative regression
   remains in `codex-cli-preflight.test.mjs`.

Verification after fixes: 21 actual-HTTP/fake-child tests plus 2 actual-CLI
no-prompt preflight tests pass. A refreshed OS sandbox probe passes 14 checks,
including canonical executable bootstrap and all previous outside read/write,
symlink, network and environment denials. Latest synthetic root is
`/private/var/folders/s5/c9slzsgj5_dbzvp02cv3569r0000gn/T/narra-sandbox-probe-CwK6Yb`.
The executable-version probe can emit a nonfatal sandbox warning while returning
the expected version with exit 0; raw stderr is not exposed.

Independent review also found malformed primitive JSON events could throw and
shutdown could return before child reaping. Both have behavioral regressions:
invalid event shapes now return an explicit 502, and shutdown awaits child close
with a bounded timeout that throws rather than claiming successful cleanup.
CLI failures expose only exit code, fixed reason category and known configuration
key identifiers, never arbitrary stderr, paths or credentials.

These fixes address startup and harness robustness. Root owns later live-canary
acceptance; they do not change the documented lack of a whole-agent guarantee.
