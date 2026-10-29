import { createHash } from "node:crypto";
import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { FirebaseAssetAutomationRuntimeStore } from "../../../src/adapters/firebase/portfolio/firebaseAssetAutomationRuntimeStore";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const householdPath = "households/house-1";
const planPath = `${householdPath}/assetAutomationPlans/plan-1`;
const assetPath = `${householdPath}/assets/asset-1`;
const revisionPath = `${householdPath}/assetAutomationPlanRevisions/plan-1_1`;
const executionKey = "house-1:asset-1:loan-repayment:2026-03";
const executionHash = createHash("sha256").update(executionKey, "utf8").digest("hex");

function fixture() {
  const memory = new InMemoryFirestore();
  memory.seed(planPath, {
    planId: "plan-1", householdId: "house-1", assetId: "asset-1", operation: "loan-repayment",
    status: "active", nextDueDate: "2026-03-18", currentRevision: 1, aggregateVersion: 1,
    firstApplicableMonth: "2026-01", activationMonthDisposition: "applicable",
  });
  memory.seed(assetPath, {
    assetId: "asset-1", householdId: "house-1", type: "loan", lifecycleState: "active",
    currentBalance: 1_000_000, aggregateVersion: 1,
  });
  memory.seed(revisionPath, {
    planId: "plan-1", householdId: "house-1", assetId: "asset-1", operation: "loan-repayment",
    revision: 1, effectiveFrom: "2026-01-01T00:00:00+09:00", configuredDay: 18,
    amountInWon: 100_000, repaymentMethod: "equal-principal-and-interest", annualInterestRate: 5,
  });
  return memory;
}

const cases: Array<{ code: string; path: string; changes: Record<string, unknown>; unresolvedIdentity?: boolean }> = [
  { code: "AUTOMATION_PLAN_IDENTITY_INVALID", path: planPath, changes: { operation: "invalid" }, unresolvedIdentity: true },
  { code: "PLAN_ASSET_TYPE_MISMATCH", path: assetPath, changes: { type: "stock" } },
  { code: "INVALID_ASSET_BALANCE", path: assetPath, changes: { currentBalance: Number.NaN } },
  { code: "AUTOMATION_REVISION_INVALID", path: revisionPath, changes: { householdId: "other-household" } },
  { code: "AUTOMATION_REVISION_NOT_FOUND", path: revisionPath, changes: { effectiveFrom: "2027-01-01T00:00:00Z" } },
  { code: "AUTOMATION_NEXT_DUE_DATE_MISMATCH", path: revisionPath, changes: { configuredDay: 19 } },
  { code: "UNSUPPORTED_LOAN_REPAYMENT_METHOD", path: revisionPath, changes: { repaymentMethod: "invalid" } },
  { code: "INVALID_INTEREST_RATE", path: revisionPath, changes: { annualInterestRate: -1 } },
  { code: "AUTOMATION_RECEIPT_WITHOUT_EXECUTION", path: `${householdPath}/assetAutomationExecutionReceipts/${executionHash}`, changes: {}, unresolvedIdentity: true },
];

describe("자동화 실패 격리 저장 계약", () => {
  it("[T-AUTO-003] 완료된 월은 revision 조회 장애에도 추가 저장 없이 기존 execution을 재생한다", async () => {
    const memory = fixture();
    const store = new FirebaseAssetAutomationRuntimeStore(memory as unknown as firestore.Firestore);
    const command = {
      plan: { householdId: "house-1", planId: "plan-1", documentPath: planPath, nextDueDate: "2026-03-18" },
      asOfDate: "2026-03-18", occurrenceId: "run-1", processedAt: "2026-03-17T15:00:00Z",
    };
    const first = await store.applyNextDue(command);
    expect(first).toMatchObject({ kind: "applied", targetMonth: "2026-03", nextDueDate: "2026-04-18" });
    const writes = vi.spyOn(memory, "write");
    const query = vi.spyOn(memory, "documentsInCollection").mockImplementation(() => {
      throw new Error("REVISION_QUERY_UNAVAILABLE");
    });

    await expect(store.applyNextDue({ ...command, occurrenceId: "run-2" })).resolves.toEqual({
      ...first, kind: "already-processed",
    });
    expect(query).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it("[T-AUTO-003] claim 문서 조회 실패 뒤 revision 조회와 저장을 시작하지 않는다", async () => {
    const memory = fixture();
    const readDocument = memory.document.bind(memory);
    vi.spyOn(memory, "document").mockImplementation(path => {
      if (path === `${householdPath}/assetAutomationExecutions/${executionHash}`) {
        throw new Error("EXECUTION_READ_UNAVAILABLE");
      }
      return readDocument(path);
    });
    const query = vi.spyOn(memory, "documentsInCollection");
    const writes = vi.spyOn(memory, "write");
    const store = new FirebaseAssetAutomationRuntimeStore(memory as unknown as firestore.Firestore);

    await expect(store.applyNextDue({
      plan: { householdId: "house-1", planId: "plan-1", documentPath: planPath, nextDueDate: "2026-03-18" },
      asOfDate: "2026-03-18", occurrenceId: "run-1", processedAt: "2026-03-17T15:00:00Z",
    })).resolves.toEqual({
      kind: "retryable-failure", targetId: `${planPath}:2026-03`, code: "AUTOMATION_UOW_COMMIT_FAILED",
    });
    expect(query).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(cases)("[T-AUTO-003] $code의 코드·target을 보존하고 Plan만 격리한다", async ({ code, path, changes, unresolvedIdentity }) => {
    const memory = fixture();
    memory.seed(path, { ...memory.document(path), ...changes });
    const assetBefore = memory.document(assetPath);
    const writes = vi.spyOn(memory, "write");
    const store = new FirebaseAssetAutomationRuntimeStore(memory as unknown as firestore.Firestore);
    const result = await store.applyNextDue({
      plan: { householdId: "house-1", planId: "plan-1", documentPath: planPath, nextDueDate: "2026-03-18" },
      asOfDate: "2026-03-18", occurrenceId: "run-1", processedAt: "2026-03-17T15:00:00Z",
    });
    expect(result).toEqual({ kind: "needs-attention", targetId: unresolvedIdentity ? `${planPath}:2026-03` : executionKey, code });
    expect(writes.mock.calls.map(([writtenPath]) => writtenPath)).toEqual([planPath]);
    expect(memory.document(planPath)).toMatchObject({ status: "needs-attention", attentionCode: code, nextDueDate: "2026-03-18", aggregateVersion: 1 });
    expect(memory.document(planPath)?.updatedAt).toBeInstanceOf(Date);
    expect(memory.document(assetPath)).toEqual(assetBefore);
    expect(memory.paths(`${householdPath}/assetAutomationExecutions/`)).toEqual([]);
    expect(memory.paths("outboxEvents/")).toEqual([]);
  });
});
