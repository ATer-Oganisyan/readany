import type { LocalCoverJob } from "./cover-job-repository";

export const COVER_COST_RECOVERY_PREFIX = "c057c057-";

/** One retry for the obsolete server cost-ledger bug, never for limits or arbitrary failures. */
export function canRecoverLegacyCoverJob(job: LocalCoverJob | null): boolean {
  return Boolean(
    job?.status === "failed" &&
      job.lastErrorMessage?.trim() === "generation cost operation is invalid" &&
      !job.requestId.startsWith(COVER_COST_RECOVERY_PREFIX),
  );
}

/** Preserve UUID v4 format required by the server while marking the one-time retry. */
export function coverRecoveryRequestId(uuid: string): string {
  return COVER_COST_RECOVERY_PREFIX + uuid.slice(9);
}
