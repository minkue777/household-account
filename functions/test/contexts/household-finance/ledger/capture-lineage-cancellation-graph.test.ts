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
});
