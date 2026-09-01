import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type BuildProfile = {
  env?: Record<string, string>;
};

const eas = JSON.parse(readFileSync(new URL("../../../eas.json", import.meta.url), "utf8")) as {
  build: Record<string, BuildProfile>;
};

describe("mobile environment profiles", () => {
  it("keeps development builds on TEST", () => {
    for (const name of ["development", "development-simulator", "preview"]) {
      expect(eas.build[name].env?.EXPO_PUBLIC_NARRA_ENVIRONMENT).toBe("test");
      expect(eas.build[name].env?.EXPO_PUBLIC_NARRA_GATEWAY_URL).toBe(
        "https://api-test.narra.disrupt.builders",
      );
    }
  });

  it("binds production builds to the production gateway", () => {
    for (const name of ["production", "production-apk"]) {
      expect(eas.build[name].env?.EXPO_PUBLIC_NARRA_ENVIRONMENT).toBe("production");
      expect(eas.build[name].env?.EXPO_PUBLIC_NARRA_GATEWAY_URL).toBe(
        "https://api.narra.disrupt.builders",
      );
    }
  });
});
