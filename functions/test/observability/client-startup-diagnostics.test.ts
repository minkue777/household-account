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

describe("[T-ADM-005] iPhone 시작 진단 로그 계약", () => {
  it("허용된 빌드/단계/숨김 관측을 복사하고 없는 관측을 0으로 만들지 않는다", () => {
    const result = normalizeClientStartupDiagnostics(valid, 2_000);
    expect(result).toEqual(valid);
    expect(result).not.toBe(valid);
    expect(result?.timingsMs).not.toBe(valid.timingsMs);
    expect(result?.timingsMs.membershipReady).toBeUndefined();
    expect(normalizeClientStartupDiagnostics({ ...valid, timingsMs: {} }, 2_000)?.timingsMs).toEqual({});
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
  ])("손상/비허용 진단은 로그에 남기지 않는다: %j", input => {
    expect(normalizeClientStartupDiagnostics(input, 2_000)).toBeUndefined();
  });
});
