import { describe, expect, it } from "vitest";
import {
  canRecoverLegacyCoverJob,
  coverRecoveryRequestId,
  COVER_COST_RECOVERY_PREFIX,
} from "./cover-job-recovery";
import type { LocalCoverJob } from "./cover-job-repository";
const failed: LocalCoverJob = {
  bookId: "book",
  requestId: "old",
  prompt: "",
  status: "failed",
  nextPollAt: 0,
  createdAt: 1,
  updatedAt: 1,
  lastErrorMessage: "generation cost operation is invalid",
};
describe("legacy cover recovery", () => {
  it("retries the old cost-ledger failure once across restarts", () => {
    expect(canRecoverLegacyCoverJob(failed)).toBe(true);
    expect(
      canRecoverLegacyCoverJob({ ...failed, requestId: COVER_COST_RECOVERY_PREFIX + "new" }),
    ).toBe(false);
  });
  it("does not resubmit active, completed, missing or unrelated failed jobs", () => {
    expect(canRecoverLegacyCoverJob(null)).toBe(false);
    for (const status of ["submitting", "queued", "running", "completed"] as const)
      expect(canRecoverLegacyCoverJob({ ...failed, status })).toBe(false);
    for (const lastErrorMessage of ["limit", "network error", "image rejected"])
      expect(canRecoverLegacyCoverJob({ ...failed, lastErrorMessage })).toBe(false);
  });
});

it("retains the UUID v4 request contract", () => {
  const id = coverRecoveryRequestId("936c2db7-bd17-408c-8742-3b4e7b7dba78");
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
