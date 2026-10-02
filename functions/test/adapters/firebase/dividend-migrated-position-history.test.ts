import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirebaseDividendHoldingQuery } from "../../../src/adapters/firebase/portfolio/firebaseDividendHoldingQuery";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const input = { householdId: "house", sourceAssetIds: ["pension"], instrumentCode: "368590" };
function fixture() {
  const db = new InMemoryFirestore();
  db.seed("operationsMigrationPlans/plan", {
    scope: { householdId: "house" }, status: "completed", nextIndex: 1, candidateCount: 1,
    createdAt: "2026-07-21T15:24:05.162Z",
  });
  db.seed("operationsMigrationPlans/plan/candidates/position", {
    action: "create", logicalCollection: "position",
    targetPath: "households/house/assets/pension/positions/holding",
    targetData: { householdId: "house", assetId: "pension", positionId: "holding", market: "KRX", instrumentCode: "368590", quantity: 855, aggregateVersion: 1, lifecycleState: "active" },
  });
  // Current quantity is deliberately different: it must never become a historical fallback.
  db.seed("households/house/assets/pension/positions/holding", { quantity: 999, updatedAt: "2026-10-02T00:00:00Z" });
  return { db, query: new FirebaseDividendHoldingQuery(db as unknown as Firestore) };
}
describe("T-DIV-008 DIV-005 완료 이관의 최초 수량 근거", () => {
  it("계획 관측 시각의 서울 날짜와 855주를 쓰고 현재 수량·운영 문서를 변경하지 않는다", async () => {
    const { db, query } = fixture();
    const before = db.paths().map(path => [path, db.document(path)]);
    expect(await query.listPositionHistory(input)).toEqual([expect.objectContaining({
      householdId: "house", assetId: "pension", positionId: "holding", instrumentCode: "368590",
      quantity: 855, snapshotDate: "2026-07-22", observedAt: "2026-07-21T15:24:05.162Z", sourceVersion: expect.any(String),
    })]);
    expect(db.paths().map(path => [path, db.document(path)])).toEqual(before);
  });
  it.each([
    { status: "planned" }, { status: "failed" }, { nextIndex: 0 }, { scope: { householdId: "other" } }, { createdAt: "invalid" },
  ])("유효한 완료 계획만 사용한다 %j", async patch => {
    const { db, query } = fixture();
    db.seed("operationsMigrationPlans/plan", { ...db.document("operationsMigrationPlans/plan"), ...patch });
    expect(await query.listPositionHistory(input)).toEqual([]);
  });
  it.each([
    { action: "merge-missing" }, { targetPath: "households/other/assets/pension/positions/holding" },
    { targetData: { householdId: "other" } }, { targetData: { assetId: "other" } },
    { targetData: { instrumentCode: "other" } }, { targetData: { quantity: -1 } },
    { targetData: { quantity: "855" } }, { targetData: { aggregateVersion: 0 } },
  ])("잘못된 후보를 추정해서 사용하지 않는다 %j", async patch => {
    const { db, query } = fixture();
    const original = db.document("operationsMigrationPlans/plan/candidates/position")!;
    db.seed("operationsMigrationPlans/plan/candidates/position", { ...original, ...patch,
      targetData: { ...(original.targetData as object), ...patch.targetData },
    });
    expect(await query.listPositionHistory(input)).toEqual([]);
  });
  it("일반 수량 이력이 있는 계좌에는 이관 근거를 중복 추가하지 않는다", async () => {
    const { db, query } = fixture();
    db.seed("households/house/assets/pension/positionHistory/normal", {
      ...input, assetId: "pension", positionId: "holding", instrument: { market: "KRX", code: "368590" },
      quantity: 860, snapshotDate: "2026-09-30", observedAt: "2026-09-30T00:00:00Z", sourceVersion: 2,
    });
    expect(await query.listPositionHistory(input)).toEqual([expect.objectContaining({ quantity: 860, sourceVersion: "2" })]);
  });
});
