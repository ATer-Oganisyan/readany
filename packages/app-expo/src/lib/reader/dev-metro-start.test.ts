import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
const wrapper = readFileSync(`${appRoot}/script/build_and_run.sh`, "utf8");
const metroConfig = readFileSync(`${appRoot}/metro.config.js`, "utf8");
const startFunction = wrapper.match(/^run_metro_prepared\(\) \{\n[\s\S]*?^\}/m)?.[0];

describe("canonical Metro startup", () => {
  it("watches the real target of worktree node_modules symlinks", () => {
    expect(metroConfig).toContain("fs.realpathSync(modulePath)");
    expect(metroConfig).toContain("monorepoRoot, ...linkedNodeModules");
  });

  it.each(["localhost", "lan"])("includes lazy imports in the initial %s bundle", (host) => {
    expect(startFunction).toBeDefined();
    // Execute the real startup function but replace pnpm with an argument/env
    // recorder. Do not start Metro, modify assets, or touch the simulator.
    const output = execFileSync(
      "bash",
      [
        "-c",
        `
set -eu
log() { :; }
check_installed_dependencies() { :; }
pnpm() {
  node -e 'process.stdout.write(JSON.stringify({ lazy: process.env.EXPO_NO_METRO_LAZY, variant: process.env.APP_VARIANT, launchUrl:process.env.EXPO_PUBLIC_NARRA_LAUNCH_GATEWAY_URL, launchEnvironment:process.env.EXPO_PUBLIC_NARRA_LAUNCH_ENVIRONMENT, launchAuth:process.env.EXPO_PUBLIC_NARRA_LAUNCH_AUTH_MODE, args: process.argv.slice(1) }))' -- "$@"
}
${startFunction}
run_metro_prepared "$1"
`,
        "metro-test",
        host,
      ],
      {
        env: {
          ...process.env,
          APP_ROOT: appRoot,
          METRO_PORT: "8081",
          EXPO_NO_METRO_LAZY: "0",
          EXPO_PUBLIC_NARRA_GATEWAY_URL: "http://127.0.0.1:18787",
          EXPO_PUBLIC_NARRA_ENVIRONMENT: "development",
          EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE: "installation",
        },
        encoding: "utf8",
      },
    );
    expect(JSON.parse(output)).toEqual({
      lazy: "1",
      variant: "development",
      launchUrl: "http://127.0.0.1:18787",
      launchEnvironment: "development",
      launchAuth: "installation",
      args: [
        "exec",
        "expo",
        "start",
        "--dev-client",
        "--scheme",
        "readany-dev",
        `--${host}`,
        "--port",
        "8081",
      ],
    });
  });

  it("does not start Metro when installed dependencies are incompatible", () => {
    expect(startFunction).toBeDefined();
    expect(() =>
      execFileSync(
        "bash",
        [
          "-c",
          `
set -eu
log() { :; }
check_installed_dependencies() { echo incompatible-native-module >&2; return 1; }
pnpm() { echo metro-must-not-start; }
${startFunction}
run_metro_prepared localhost
`,
        ],
        {
          env: { ...process.env, APP_ROOT: appRoot, METRO_PORT: "8081" },
          encoding: "utf8",
          stdio: "pipe",
        },
      ),
    ).toThrow(/incompatible-native-module/);
  });
});
