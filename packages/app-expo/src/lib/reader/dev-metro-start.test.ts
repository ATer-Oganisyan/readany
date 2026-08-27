import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
const wrapper = readFileSync(`${appRoot}/script/build_and_run.sh`, "utf8");
const startFunction = wrapper.match(/^run_metro_prepared\(\) \{\n[\s\S]*?^\}/m)?.[0];

describe("canonical Metro startup", () => {
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
pnpm() {
  node -e 'process.stdout.write(JSON.stringify({ lazy: process.env.EXPO_NO_METRO_LAZY, variant: process.env.APP_VARIANT, args: process.argv.slice(1) }))' -- "$@"
}
${startFunction}
run_metro_prepared "$1"
`,
        "metro-test",
        host,
      ],
      {
        env: { ...process.env, APP_ROOT: appRoot, METRO_PORT: "8081", EXPO_NO_METRO_LAZY: "0" },
        encoding: "utf8",
      },
    );
    expect(JSON.parse(output)).toEqual({
      lazy: "1",
      variant: "development",
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
});
