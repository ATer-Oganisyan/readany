import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const wrapper = readFileSync(
  fileURLToPath(new URL("../../../script/build_and_run.sh", import.meta.url)),
  "utf8",
);
const extract = (name: string) =>
  wrapper.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, "m"))?.[0] ??
  `${name}() { echo missing-${name} >&2; return 99; }`;
const udid = "984D0C64-C0B2-4204-92A9-2C65519089E8";
const defaults = `
set -euo pipefail
exec 3>&2
log() { :; }
die() { echo "$*" >&2; exit 1; }
check_simulator_prerequisites() { :; }
check_installed_dependencies() { test "\${BAD_DEPS:-0}" = 0 || die incompatible-dependencies; }
assert_simulator_ui_matches_toolchain() { :; }
assert_pasteboard_sync_is_safe() { :; }
expected_build_number() { echo 36; }
native_fingerprint() { echo fingerprint; }
app_build_number() { echo "\${BUILD:-36}"; }
app_binary_hash() { if [ "$1" = "$CANONICAL_APP" ]; then echo canonical; else echo "\${INSTALLED_HASH:-canonical}"; fi; }
plist_value() { echo com.mishanaer.readany.dev; }
installed_app_path() { echo "\${INSTALLED:-}"; }
boot_simulator() { echo "boot:$SIMULATOR_ID"; }
xcrun() {
  case "$1 $2" in
    'simctl list') echo '{"devices":{"ios":[{"udid":"${udid}","isAvailable":true}]}}' ;;
    'simctl listapps')
      [ "\${LIST_FAIL:-0}" = 0 ] || return 1
      if [ "\${MALFORMED:-0}" = 1 ]; then echo 'bad-json';
      elif [ -n "\${INSTALLED:-}" ]; then echo '{"com.mishanaer.readany.dev":{}}';
      else echo '{}'; fi ;;
    'simctl get_app_container') [ "\${LOOKUP_FAIL:-0}" = 0 ] || return 1; echo "\${INSTALLED:-}" ;;
    *) echo "xcrun:$*"; echo "record:$*" >&3; if [ "$1 $2" = 'simctl terminate' ] && [ "\${TERMINATE_FAIL:-0}" = 1 ]; then return 1; fi ;;
  esac
}
plutil() { cat; }
open() { echo "open:$*"; }
pnpm() { echo forbidden-pnpm; exit 91; }
xcodebuild() { echo forbidden-build; exit 92; }
prepare_development_variant() { echo forbidden-prepare; exit 93; }
ensure_reader_asset() { echo forbidden-reader; exit 94; }
`;
function run(script: string, env: Record<string, string> = {}) {
  return spawnSync("bash", ["-c", `${defaults}\n${script}`], {
    encoding: "utf8",
    env: {
      ...process.env,
      READANY_SIMULATOR_ID: udid,
      SIMULATOR_ID: udid,
      BUNDLE_ID: "com.mishanaer.readany.dev",
      METRO_PORT: "8082",
      SIMULATOR_UI_NAME: "Simulator",
      SIMULATOR_UI_APP: "fake.app",
      EXPO_PUBLIC_NARRA_GATEWAY_URL: "http://127.0.0.1:18787",
      ...env,
    },
  });
}

describe("install existing canonical client only", () => {
  function install(env: Record<string, string> = {}, fingerprint = "fingerprint") {
    const root = mkdtempSync(join(tmpdir(), "narra-install-only-test-"));
    try {
      const app = join(root, "Narra.app");
      mkdirSync(app);
      writeFileSync(join(root, "fingerprint"), fingerprint);
      return run(`${extract("run_install_canonical_only")}\nrun_install_canonical_only`, {
        CANONICAL_APP: app,
        FINGERPRINT_FILE: join(root, "fingerprint"),
        ...env,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  it("installs only on the explicit empty target, without build, assets or Metro", () => {
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`xcrun:simctl install ${udid}`);
    expect(result.stdout).not.toMatch(/forbidden|launch|openurl|uninstall|erase/);
  });
  it("does nothing to an already identical canonical app", () => {
    const result = install({ INSTALLED: "/installed" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/xcrun:simctl install/);
  });
  it.each<Record<string, string>>([
    { READANY_SIMULATOR_ID: "" },
    { READANY_SIMULATOR_ID: "wrong" },
    { BAD_DEPS: "1" },
    { BUILD: "35" },
  ])("fails before touching a device for %j", (env) => {
    const result = install(env);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toMatch(/boot:|xcrun:simctl install/);
  });
  it("rejects stale native fingerprint before installation", () => {
    const result = install({}, "old");
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("boot:");
  });
  it.each<Record<string, string>>([
    { LIST_FAIL: "1" },
    { MALFORMED: "1" },
    { INSTALLED: "/installed", LOOKUP_FAIL: "1" },
    { INSTALLED: "/installed", INSTALLED_HASH: "other" },
  ])("never installs after ambiguous or conflicting app inventory %j", (env) => {
    const result = install(env);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("xcrun:simctl install");
  });
});

describe("strict LOCAL Metro launch", () => {
  const valid = "readany-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082";
  const launch = (url: string, env: Record<string, string> = {}) =>
    run(
      `
${extract("strict_dev_client_launch")}
${extract("validate_strict_dev_client_url")}
${extract("open_dev_client_url")}
${extract("launch_app")}
dev_client_url() { printf '%s' "$MOCK_URL"; }
launch_app`,
      { MOCK_URL: url, ...env },
    );
  it.each([
    "",
    valid.replace("8082", "8081"),
    valid.replace("127.0.0.1", "example.com"),
    "https://example.com",
  ])("refuses unsafe LOCAL URL %s before native launch", (url) => {
    const result = launch(url);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toMatch(/xcrun:|open:/);
    expect(result.stderr).not.toMatch(/record:simctl (launch|terminate|openurl)/);
  });
  it("opens verified LOCAL URL only on the selected simulator", () => {
    const result = launch(valid);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(`record:simctl openurl ${udid} ${valid}`);
    expect(result.stderr).toContain(`record:simctl terminate ${udid} com.mishanaer.readany.dev`);
    expect(result.stdout + result.stderr).not.toContain("simctl launch");
    expect(result.stderr.indexOf("simctl terminate")).toBeLessThan(
      result.stderr.indexOf("simctl openurl"),
    );
  });
  it("preserves remote fallback unless strict is explicitly requested", () => {
    const env = { EXPO_PUBLIC_NARRA_GATEWAY_URL: "https://api-test.narra.disrupt.builders" };
    expect(launch("", env).status).toBe(0);
    expect(launch("", env).stderr).toContain(
      `record:simctl launch --terminate-running-process ${udid}`,
    );
    expect(launch("", { ...env, READANY_STRICT_METRO_LAUNCH: "1" }).status).not.toBe(0);
  });
  it("still opens the validated URL when the selected app was not running", () => {
    const result = launch(valid, { TERMINATE_FAIL: "1" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(`record:simctl openurl ${udid} ${valid}`);
    expect(result.stdout + result.stderr).not.toContain("simctl launch");
  });
});
