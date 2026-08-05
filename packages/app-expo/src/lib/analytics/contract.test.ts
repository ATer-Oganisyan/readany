import { describe, expect, it } from "vitest";
import { characterCountBucket, durationBucket, sanitizeAnalyticsProperties } from "./contract";

describe("analytics privacy contract", () => {
  it("drops content-shaped and event-incompatible properties", () => {
    expect(
      sanitizeAnalyticsProperties("character_opened", {
        feature: "character",
        title: "Анна Каренина",
        prompt: "full book excerpt",
        duration_seconds: 10,
      }),
    ).toEqual({ feature: "character" });
  });

  it("rejects covert strings and invalid enums", () => {
    expect(
      sanitizeAnalyticsProperties("book_analysis_failed", {
        analysis_version: "v1",
        origin: "user",
        stage: "provider",
        safe_error_code: "raw provider message\nwith content",
      }),
    ).toEqual({ analysis_version: "v1", origin: "user", stage: "provider" });
  });

  it("uses stable coarse buckets", () => {
    expect(durationBucket(999)).toBe("<1s");
    expect(durationBucket(60_000)).toBe("1-4m");
    expect(characterCountBucket(6)).toBe("4-8");
  });
});
