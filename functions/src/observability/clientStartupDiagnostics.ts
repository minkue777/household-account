/** 시작 진단은 운영 로그 전용이며 사용자 자료나 요청 원문을 보존하지 않습니다. */
const TIMING_KEYS = [
  "navigationResponseStart", "navigationResponseEnd", "domInteractive",
  "bootstrapStarted", "authStarted", "authReady", "membershipStarted",
  "membershipReady", "householdStarted", "householdReady", "ledgerReady",
  "categoriesReady", "localCurrencyReady", "yearSummaryReady", "homeReady",
  "firstLedgerPaint", "firstHomeCompletePaint",
] as const;

export interface ClientStartupDiagnostics {
  readonly version: 1;
  readonly webBuild?: string;
  readonly navigationType?: "navigate" | "reload" | "back_forward" | "prerender";
  readonly initialVisibility: "visible" | "hidden" | "unknown";
  readonly visibilityTrackingStartedAtMs: number;
  readonly hiddenMs: number;
  readonly hiddenCount: number;
  readonly serviceWorkerControlled?: boolean;
  readonly yearSummaryRequired?: boolean;
  readonly cache?: {
    readonly bootstrap?: "hit" | "miss";
    readonly membership?: "hit" | "prefetched";
    readonly household?: "hit" | "miss";
  };
  readonly timingsMs: Partial<Record<typeof TIMING_KEYS[number], number>>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

/** 추가 진단의 손상은 접속/총시간 기록을 거절하지 않고 이 진단만 생략합니다. */
export function normalizeClientStartupDiagnostics(
  input: unknown,
  durationMs: number,
): ClientStartupDiagnostics | undefined {
  const value = record(input);
  if (!value || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 120_000) {
    return undefined;
  }
  const boundedTime = (candidate: unknown): candidate is number =>
    typeof candidate === "number" && Number.isFinite(candidate) &&
    candidate >= 0 && candidate <= durationMs;
  const rounded = (candidate: number) => Math.round(candidate * 1_000) / 1_000;
  if (!onlyKeys(value, [
    "version", "webBuild", "navigationType", "initialVisibility",
    "visibilityTrackingStartedAtMs", "hiddenMs", "hiddenCount",
    "serviceWorkerControlled", "yearSummaryRequired", "cache", "timingsMs",
  ]) || value.version !== 1 ||
    typeof value.initialVisibility !== "string" ||
    !["visible", "hidden", "unknown"].includes(value.initialVisibility) ||
    !boundedTime(value.visibilityTrackingStartedAtMs) ||
    !boundedTime(value.hiddenMs) ||
    typeof value.hiddenCount !== "number" || !Number.isInteger(value.hiddenCount) ||
    value.hiddenCount < 0 || value.hiddenCount > 1_000
  ) return undefined;

  if (value.webBuild !== undefined && (
    typeof value.webBuild !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/u.test(value.webBuild)
  )) return undefined;
  if (value.navigationType !== undefined && (typeof value.navigationType !== "string" || ![
    "navigate", "reload", "back_forward", "prerender",
  ].includes(value.navigationType))) return undefined;
  for (const key of ["serviceWorkerControlled", "yearSummaryRequired"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return undefined;
  }
  const timings = record(value.timingsMs);
  if (!timings || !onlyKeys(timings, TIMING_KEYS)) return undefined;
  const timingsMs: ClientStartupDiagnostics["timingsMs"] = {};
  for (const key of TIMING_KEYS) {
    if (timings[key] === undefined) continue;
    if (!boundedTime(timings[key])) return undefined;
    timingsMs[key] = rounded(timings[key]);
  }
  let cache: ClientStartupDiagnostics["cache"];
  if (value.cache !== undefined) {
    const source = record(value.cache);
    if (!source || !onlyKeys(source, ["bootstrap", "membership", "household"])) return undefined;
    if (source.bootstrap !== undefined && source.bootstrap !== "hit" && source.bootstrap !== "miss") return undefined;
    if (source.membership !== undefined && source.membership !== "hit" && source.membership !== "prefetched") return undefined;
    if (source.household !== undefined && source.household !== "hit" && source.household !== "miss") return undefined;
    cache = {
      ...(source.bootstrap === undefined ? {} : { bootstrap: source.bootstrap }),
      ...(source.membership === undefined ? {} : { membership: source.membership }),
      ...(source.household === undefined ? {} : { household: source.household }),
    };
  }
  return {
    version: 1,
    ...(value.webBuild === undefined ? {} : { webBuild: value.webBuild as string }),
    ...(value.navigationType === undefined ? {} : {
      navigationType: value.navigationType as ClientStartupDiagnostics["navigationType"],
    }),
    initialVisibility: value.initialVisibility as ClientStartupDiagnostics["initialVisibility"],
    visibilityTrackingStartedAtMs: rounded(value.visibilityTrackingStartedAtMs),
    hiddenMs: rounded(value.hiddenMs),
    hiddenCount: value.hiddenCount,
    ...(value.serviceWorkerControlled === undefined ? {} : {
      serviceWorkerControlled: value.serviceWorkerControlled as boolean,
    }),
    ...(value.yearSummaryRequired === undefined ? {} : {
      yearSummaryRequired: value.yearSummaryRequired as boolean,
    }),
    ...(cache === undefined ? {} : { cache }),
    timingsMs,
  };
}
