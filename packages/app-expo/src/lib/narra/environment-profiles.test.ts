import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type BuildProfile = {
  channel?: string;
  distribution?: string;
  env?: Record<string, string>;
  ios?: { simulator?: boolean };
};

const eas = JSON.parse(readFileSync(new URL("../../../eas.json", import.meta.url), "utf8")) as {
  build: Record<string, BuildProfile>;
};

describe("mobile environment profiles", () => {
  it("keeps the simulator on TEST and disables analytics", () => {
    const profile = eas.build["development-simulator"];
    expect(profile.ios?.simulator).toBe(true);
    expect(profile.channel).toBe("development");
    expect(profile.env?.EXPO_PUBLIC_NARRA_ENVIRONMENT).toBe("test");
    expect(profile.env?.EXPO_PUBLIC_NARRA_GATEWAY_URL).toBe(
      "https://api-test.narra.disrupt.builders",
    );
    expect(profile.env?.EXPO_PUBLIC_NARRA_ANALYTICS_TIER).toBe("none");
  });

  it("binds internal builds to TEST", () => {
    for (const name of ["development", "preview"]) {
      const profile = eas.build[name];
      expect(profile.distribution).toBe("internal");
      expect(profile.channel).toBe("test");
      expect(profile.env?.EXPO_PUBLIC_NARRA_ENVIRONMENT).toBe("test");
      expect(profile.env?.EXPO_PUBLIC_NARRA_GATEWAY_URL).toBe(
        "https://api-test.narra.disrupt.builders",
      );
    }
  });

  it("binds store builds only to the production API and channel", () => {
    for (const name of ["production", "production-apk"]) {
      const profile = eas.build[name];
      expect(profile.channel).toBe("production");
      expect(profile.env?.EXPO_PUBLIC_NARRA_ENVIRONMENT).toBe("production");
      expect(profile.env?.EXPO_PUBLIC_NARRA_GATEWAY_URL).toBe("https://api.narra.disrupt.builders");
      expect(JSON.stringify(profile.env)).not.toContain("api-test");
    }
  });
});
