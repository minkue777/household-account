import { describe, expect, it } from "vitest";

import { planCaptureLineageCancellation } from "../../../../src/contexts/household-finance/ledger/domain/policies/captureLineageCancellationGraph";

describe("capture lineage cancellation graph", () => {
  it.each(["superseded", "deleted"] as const)(
    "%s 과거 병합은 leaf의 복원 근거가 되지 않는다",
    (lifecycleState) => {
    const plan = planCaptureLineageCancellation({
      captureLineageId: "lineage-a",
      transactions: [
        {
          transactionId: "A",
          lifecycleState: "active",
          captureLineageIds: ["lineage-a"],
          parentTransactionIds: [],
          mergeLeafIds: [],
        },
        {
          transactionId: "B",
          lifecycleState: "deleted",
          captureLineageIds: ["lineage-b"],
          parentTransactionIds: [],
          mergeLeafIds: [],
        },
        {
          transactionId: "M",
          lifecycleState,
          captureLineageIds: ["lineage-a"],
          parentTransactionIds: [],
          mergeLeafIds: ["A", "B"],
        },
      ],
    });

    expect([...plan.affectedTransactionIds].sort()).toEqual(["A", "M"]);
    expect(plan.restorableLeafIds).toEqual([]);
    },
  );

  it("활성 병합 출력은 취소 lineage가 아닌 leaf를 복원 후보로 제공한다", () => {
    const plan = planCaptureLineageCancellation({
      captureLineageId: "lineage-a",
      transactions: [
        {
          transactionId: "A",
          lifecycleState: "superseded",
          captureLineageIds: ["lineage-a"],
          parentTransactionIds: [],
          mergeLeafIds: [],
        },
        {
          transactionId: "B",
          lifecycleState: "superseded",
          captureLineageIds: ["lineage-b"],
          parentTransactionIds: [],
          mergeLeafIds: [],
        },
        {
          transactionId: "M",
          lifecycleState: "active",
          captureLineageIds: ["lineage-a"],
          parentTransactionIds: [],
          mergeLeafIds: ["A", "B"],
        },
      ],
    });

    expect([...plan.affectedTransactionIds].sort()).toEqual(["A", "M"]);
    expect(plan.restorableLeafIds).toEqual(["B"]);
  });

  it("취소 lineage와 무관한 불완전한 활성 legacy 병합은 그래프를 무효화하지 않는다", () => {
    const plan = planCaptureLineageCancellation({
      captureLineageId: "lineage-a",
      transactions: [
        {
          transactionId: "A",
          lifecycleState: "active",
          captureLineageIds: ["lineage-a"],
          parentTransactionIds: [],
          mergeLeafIds: [],
        },
        {
          transactionId: "legacy-unrelated",
          lifecycleState: "active",
          captureLineageIds: ["lineage-unrelated"],
          parentTransactionIds: [],
          mergeLeafIds: [],
          legacyMergeSnapshotPresent: true,
        },
      ],
    });

    expect(plan.affectedTransactionIds).toEqual(["A"]);
    expect(plan.invalidGraph).toBe(false);
  });

  it.each([
    ["active", true],
    ["superseded", false],
  ] as const)(
    "취소 lineage의 %s 불완전 legacy 병합은 invalidGraph=%s로 판정한다",
    (lifecycleState, expectedInvalidGraph) => {
      const plan = planCaptureLineageCancellation({
        captureLineageId: "lineage-a",
        transactions: [
          {
            transactionId: "A",
            lifecycleState: "active",
            captureLineageIds: ["lineage-a"],
            parentTransactionIds: [],
            mergeLeafIds: [],
          },
          {
            transactionId: "legacy-relevant",
            lifecycleState,
            captureLineageIds: ["lineage-a"],
            parentTransactionIds: [],
            mergeLeafIds: [],
            legacyMergeSnapshotPresent: true,
          },
        ],
      });

      expect([...plan.affectedTransactionIds].sort()).toEqual([
        "A",
        "legacy-relevant",
      ]);
      expect(plan.invalidGraph).toBe(expectedInvalidGraph);
    },
  );
});
