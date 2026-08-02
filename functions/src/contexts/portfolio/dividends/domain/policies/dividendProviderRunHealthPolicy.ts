export type DividendProviderHealthResultKind =
  | "SUCCESS"
  | "NO_DATA"
  | "PARTIAL_FAILURE"
  | "RETRYABLE_FAILURE"
  | "CONTRACT_FAILURE";

export interface DividendProviderRunCounts {
  readonly success: number;
  readonly noData: number;
  readonly retryableFailure: number;
  readonly contractFailure: number;
}

export interface PreviousDividendProviderHealth {
  readonly lastAttemptAt: string;
  readonly lastSuccessAt?: string;
  readonly consecutiveFailedRuns: number;
  readonly failureStartedAt?: string;
  readonly alertState: "closed" | "open";
  readonly version: number;
}

export interface DividendProviderRunHealth {
  readonly status: "healthy" | "degraded" | "outage";
  readonly lastAttemptAt: string;
  readonly lastSuccessAt?: string;
  /** Consecutive occurrences in which every provider target failed. */
  readonly consecutiveFailedRuns: number;
  readonly failureStartedAt?: string;
  readonly lastResultKind: DividendProviderHealthResultKind;
  readonly lastErrorCode?: string;
  readonly alertState: "closed" | "open";
  readonly recoveredAt?: string;
  readonly lastRunTargetCount: number;
  readonly lastRunSucceededTargets: number;
  readonly lastRunFailedTargets: number;
  readonly version: number;
}

export type DividendProviderRunHealthDecision =
  | { readonly kind: "ignored"; readonly reason: "NO_PROVIDER_TARGETS" }
  | {
      readonly kind: "updated";
      readonly health: DividendProviderRunHealth;
      readonly alertTransition?: "opened" | "resolved";
    };

function count(values: DividendProviderRunCounts): number {
  return (
    values.success +
    values.noData +
    values.retryableFailure +
    values.contractFailure
  );
}

function failureResultKind(
  values: DividendProviderRunCounts,
): "RETRYABLE_FAILURE" | "CONTRACT_FAILURE" {
  return values.contractFailure > 0
    ? "CONTRACT_FAILURE"
    : "RETRYABLE_FAILURE";
}

/**
 * KIND availability is decided once per scheduled occurrence, never by the
 * completion order of individual instruments.
 */
export function decideDividendProviderRunHealth(input: {
  readonly observedAt: string;
  readonly counts: DividendProviderRunCounts;
  readonly lastErrorCode?: string;
  readonly previous?: PreviousDividendProviderHealth;
  readonly outageAfterConsecutiveFullFailures?: number;
}): DividendProviderRunHealthDecision {
  const targetCount = count(input.counts);
  if (targetCount === 0) {
    return { kind: "ignored", reason: "NO_PROVIDER_TARGETS" };
  }

  const succeededTargets = input.counts.success + input.counts.noData;
  const failedTargets =
    input.counts.retryableFailure + input.counts.contractFailure;
  const previousOpen = input.previous?.alertState === "open";
  const version = (input.previous?.version ?? 0) + 1;
  const common = {
    lastAttemptAt: input.observedAt,
    lastRunTargetCount: targetCount,
    lastRunSucceededTargets: succeededTargets,
    lastRunFailedTargets: failedTargets,
    version,
  } as const;

  if (failedTargets === 0) {
    const health: DividendProviderRunHealth = {
      ...common,
      status: "healthy",
      lastSuccessAt: input.observedAt,
      consecutiveFailedRuns: 0,
      lastResultKind: input.counts.success > 0 ? "SUCCESS" : "NO_DATA",
      alertState: "closed",
      ...(previousOpen ? { recoveredAt: input.observedAt } : {}),
    };
    return {
      kind: "updated",
      health,
      ...(previousOpen ? { alertTransition: "resolved" as const } : {}),
    };
  }

  if (succeededTargets > 0) {
    const health: DividendProviderRunHealth = {
      ...common,
      status: "degraded",
      lastSuccessAt: input.observedAt,
      consecutiveFailedRuns: 0,
      lastResultKind: "PARTIAL_FAILURE",
      ...(input.lastErrorCode === undefined
        ? {}
        : { lastErrorCode: input.lastErrorCode }),
      alertState: "closed",
      ...(previousOpen ? { recoveredAt: input.observedAt } : {}),
    };
    return {
      kind: "updated",
      health,
      ...(previousOpen ? { alertTransition: "resolved" as const } : {}),
    };
  }

  const consecutiveFailedRuns =
    (input.previous?.consecutiveFailedRuns ?? 0) + 1;
  const outageThreshold = input.outageAfterConsecutiveFullFailures ?? 3;
  const outage = previousOpen || consecutiveFailedRuns >= outageThreshold;
  const health: DividendProviderRunHealth = {
    ...common,
    status: outage ? "outage" : "degraded",
    ...(input.previous?.lastSuccessAt === undefined
      ? {}
      : { lastSuccessAt: input.previous.lastSuccessAt }),
    consecutiveFailedRuns,
    failureStartedAt:
      input.previous?.consecutiveFailedRuns === undefined ||
      input.previous.consecutiveFailedRuns === 0
        ? input.observedAt
        : (input.previous.failureStartedAt ?? input.observedAt),
    lastResultKind: failureResultKind(input.counts),
    ...(input.lastErrorCode === undefined
      ? {}
      : { lastErrorCode: input.lastErrorCode }),
    alertState: outage ? "open" : "closed",
  };
  return {
    kind: "updated",
    health,
    ...(outage && !previousOpen
      ? { alertTransition: "opened" as const }
      : {}),
  };
}
