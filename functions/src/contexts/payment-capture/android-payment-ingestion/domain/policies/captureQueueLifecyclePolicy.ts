import type {
  CaptureQueueBranchName,
  CaptureQueueEntry,
  CaptureQueueServerBranchResult,
  EnqueueCaptureObservationInput,
} from "../model/androidCaptureQueue";

const RETENTION_MILLISECONDS = 72 * 60 * 60 * 1_000;

export function captureQueueBranchSetIsValid(
  input: EnqueueCaptureObservationInput,
): boolean {
  if (input.branches.length === 0) return false;
  const branchNames = input.branches.map(({ branch }) => branch);
  return new Set(branchNames).size === branchNames.length;
}

export function createCaptureQueueEntry(
  input: EnqueueCaptureObservationInput,
): CaptureQueueEntry {
  return {
    observationId: input.observationId,
    actor: { ...input.actor },
    queuedAt: input.queuedAt,
    pendingBranches: input.branches.map((branch) => ({ ...branch })),
    terminalBranches: [],
  };
}

export function captureQueueEntryIsExpired(input: {
  readonly queuedAt: string;
  readonly now: string;
}): boolean {
  const queuedAt = new Date(input.queuedAt).getTime();
  const now = new Date(input.now).getTime();
  if (Number.isNaN(queuedAt) || Number.isNaN(now)) return true;
  return now - queuedAt >= RETENTION_MILLISECONDS;
}

export function applyCaptureQueueBranchResults(input: {
  readonly entry: CaptureQueueEntry;
  readonly results: ReadonlyMap<
    CaptureQueueBranchName,
    CaptureQueueServerBranchResult
  >;
}): CaptureQueueEntry {
  const stillPending = [];
  const newlyTerminal = [];
  for (const branch of input.entry.pendingBranches) {
    const result = input.results.get(branch.branch);
    if (result === undefined || result.kind === "RetryableFailure") {
      stillPending.push({ ...branch });
      continue;
    }
    newlyTerminal.push({
      branch: branch.branch,
      idempotencyKey: branch.idempotencyKey,
      result: { ...result },
    });
  }
  return {
    observationId: input.entry.observationId,
    actor: { ...input.entry.actor },
    queuedAt: input.entry.queuedAt,
    pendingBranches: stillPending,
    terminalBranches: [
      ...input.entry.terminalBranches.map((branch) => ({
        ...branch,
        result: { ...branch.result },
      })),
      ...newlyTerminal,
    ],
  };
}
