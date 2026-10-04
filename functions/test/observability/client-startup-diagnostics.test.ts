import { describe, expect, it } from "vitest";
import { normalizeClientStartupDiagnostics } from "../../src/observability/clientStartupDiagnostics";

const valid = {
  version: 1,
  webBuild: "8a36347810575ba80c4a4464d1e27f98195f8182",
  navigationType: "reload",
  initialVisibility: "visible",
  visibilityTrackingStartedAtMs: 200,
  hiddenMs: 500,
  hiddenCount: 1,
  serviceWorkerControlled: true,
  yearSummaryRequired: false,
  cache: { bootstrap: "hit", membership: "hit", household: "miss" },
  timingsMs: { navigationResponseEnd: 100, bootstrapStarted: 200, authReady: 350, ledgerReady: 1_800, firstHomeCompletePaint: 2_000 },
};

const readPhaseTimings = {
  ledgerInitialReadStarted: 400,
  ledgerInitialReadReceived: 500,
  ledgerInitialReadFallback: 600,
  categoriesInitialReadStarted: 400,
  categoriesInitialReadReceived: 500,
  categoriesInitialReadFallback: 600,
  currencyPreferencesInitialReadStarted: 400,
  currencyPreferencesInitialReadReceived: 500,
  currencyPreferencesInitialReadFallback: 600,
  currencyBalancesInitialReadStarted: 400,
  currencyBalancesInitialReadReceived: 500,
  currencyBalancesInitialReadFallback: 600,
  authTokenObserved: 300,
  authTokenRequestStarted: 250,
  authTokenResponseEnd: 280,
  householdReadStarted: 400,
  householdSnapshotReceived: 1_650,
  ledgerListenStarted: 450,
  ledgerServerSnapshotReceived: 1_700,
  categoriesListenStarted: 460,
  categoriesServerSnapshotReceived: 1_500,
  currencyPreferencesListenStarted: 470,
  currencyPreferencesServerSnapshotReceived: 1_550,
  currencyBalancesListenStarted: 480,
  currencyBalancesServerSnapshotReceived: 1_600,
  yearSummaryListenStarted: 490,
  yearSummaryFirstSnapshotReceived: 510,
  yearSummaryServerSnapshotReceived: 1_750,
};

describe("[T-ADM-005] iPhone 시작 진단 로그 계약", () => {
  const android = { webDurationMs: 2_000, bridgeRoundTripMs: 12.34567,
    nativeTimingsMs: { webViewReady: 100, navigationRequested: 2_500 } };

  it("Android의 Web와 Native 시각을 서로 다른 기준으로 검증하고 구 APK 누락은 보존한다", () => {
    const result = normalizeClientStartupDiagnostics({ ...valid, android }, 3_000, "android");
    expect(result).toEqual({ ...valid, android: { ...android, bridgeRoundTripMs: 12.346 } });
    expect(result?.android?.nativeTimingsMs).not.toBe(android.nativeTimingsMs);
    expect(normalizeClientStartupDiagnostics({ ...valid, android: { webDurationMs: 2_000, bridgeRoundTripMs: 0 } }, 1_000, "android")?.android)
      .toEqual({ webDurationMs: 2_000, bridgeRoundTripMs: 0 });
    expect(normalizeClientStartupDiagnostics({ ...valid, android }, 3_000)).toBeUndefined();
    expect(normalizeClientStartupDiagnostics(valid, 3_000, "android")).toBeUndefined();
  });

  it.each([
    { ...valid, android: { ...android, webDurationMs: 1_999 } },
    { ...valid, android: { ...android, bridgeRoundTripMs: -1 } },
    { ...valid, android: { ...android, bridgeRoundTripMs: 120_001 } },
    { ...valid, android: { ...android, webDurationMs: Infinity } },
    { ...valid, android: { ...android, nativeTimingsMs: { webViewReady: 3_001 } } },
    { ...valid, android: { ...android, nativeTimingsMs: { webViewReady: 800, navigationRequested: 700 } } },
    { ...valid, android: { ...android, nativeTimingsMs: { navigationRequested: "secret" } } },
    { ...valid, android: { ...android, nativeTimingsMs: { url: "https://private" } } },
    { ...valid, android: { ...android, user: "private" } },
  ])("Android 범위·순서·비허용 필드 손상은 진단만 거부한다", input => {
    expect(normalizeClientStartupDiagnostics(input, 3_000, "android")).toBeUndefined();
  });
  it("허용된 빌드/단계/숨김 관측을 복사하고 없는 관측을 0으로 만들지 않는다", () => {
    const result = normalizeClientStartupDiagnostics(valid, 2_000);
    expect(result).toEqual(valid);
    expect(result).not.toBe(valid);
    expect(result?.timingsMs).not.toBe(valid.timingsMs);
    expect(result?.timingsMs.membershipReady).toBeUndefined();
    expect(result?.timingsMs.authTokenObserved).toBeUndefined();
    expect(result?.timingsMs.yearSummaryServerSnapshotReceived).toBeUndefined();
    expect(normalizeClientStartupDiagnostics({ ...valid, timingsMs: {} }, 2_000)?.timingsMs).toEqual({});
  });

  it("인증·초기 조회·서버 snapshot 관측을 기존 v1의 선택 필드로 보존한다", () => {
    const candidate = { ...valid, timingsMs: { ...valid.timingsMs, ...readPhaseTimings } };
    const result = normalizeClientStartupDiagnostics(candidate, 2_000);
    expect(result).toEqual(candidate);
    expect(result?.version).toBe(1);
    expect(result?.timingsMs).not.toBe(candidate.timingsMs);
  });

  it.each(Object.keys(readPhaseTimings))("%s만 있어도 수용하고 0·전체 시간 경계와 반올림을 유지한다", key => {
    for (const [observed, expected] of [[0, 0], [2_000, 2_000], [1_234.5678, 1_234.568]]) {
      const result = normalizeClientStartupDiagnostics({ ...valid, timingsMs: { [key]: observed } }, 2_000);
      expect(result?.timingsMs).toEqual({ [key]: expected });
    }
  });

  it.each(Object.keys(readPhaseTimings))("%s의 손상 값은 진단만 거부한다", key => {
    for (const observed of [-1, 2_000.001, NaN, Infinity, -Infinity, "1_000", null, {}]) {
      expect(normalizeClientStartupDiagnostics({
        ...valid, timingsMs: { ...readPhaseTimings, [key]: observed },
      }, 2_000)).toBeUndefined();
    }
  });

  it("요청·서버 관측이 없는 최초 연간 캐시 callback도 선택 필드로 보존한다", () => {
    const result = normalizeClientStartupDiagnostics({
      ...valid, timingsMs: { yearSummaryFirstSnapshotReceived: 800 },
    }, 2_000);
    expect(result?.timingsMs).toEqual({ yearSummaryFirstSnapshotReceived: 800 });
  });

  it.each([
    undefined, null, [], { ...valid, version: 2 },
    { ...valid, uid: "private-user" },
    { ...valid, webBuild: "https://private/path?token=secret" },
    { ...valid, webBuild: "x".repeat(129) },
    { ...valid, initialVisibility: ["visible"] },
    { ...valid, navigationType: "unknown-value" },
    { ...valid, hiddenMs: -1 }, { ...valid, hiddenMs: 2_001 },
    { ...valid, visibilityTrackingStartedAtMs: Infinity },
    { ...valid, hiddenCount: 1.1 }, { ...valid, hiddenCount: 1_001 },
    { ...valid, serviceWorkerControlled: "yes" },
    { ...valid, cache: { householdId: "private-household" } },
    { ...valid, cache: { membership: "miss" } },
    { ...valid, timingsMs: { merchant: "private-merchant" } },
    { ...valid, timingsMs: { authReady: NaN } },
    { ...valid, timingsMs: { authReady: 2_001 } },
    { ...valid, timingsMs: { ...readPhaseTimings, authToken: "secret-token" } },
    { ...valid, timingsMs: { ...readPhaseTimings, authTokenRequestUrl: "https://securetoken.googleapis.com/v1/token?key=private-key" } },
    { ...valid, timingsMs: { ...readPhaseTimings, householdSnapshot: { householdId: "private-household" } } },
  ])("손상/비허용 진단은 로그에 남기지 않는다: %j", input => {
    expect(normalizeClientStartupDiagnostics(input, 2_000)).toBeUndefined();
  });
});
