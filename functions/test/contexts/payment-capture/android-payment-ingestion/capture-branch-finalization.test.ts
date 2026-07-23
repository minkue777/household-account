import { describe, expect, it } from "vitest";

import { createCaptureBranchSubmissionApplication } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import type { CaptureBranchEnvelope } from "../../../../src/contexts/payment-capture/android-payment-ingestion/public";
import type { CaptureSubmissionReceipt } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";

describe("Capture branch 최종 receipt 복구", () => {
  it("구버전 실행이 모든 branch를 terminal로 남기고 종료됐으면 downstream 재호출 없이 completed로 복구한다", async () => {
    const envelope: CaptureBranchEnvelope = {
      rootIdempotencyKey: "legacy-processing-receipt",
      householdId: "household-1",
      transactionBranch: {
        branchKey: "payment-1",
        merchant: "가맹점",
        amountInWon: 10_000,
        occurredAt: "2026-07-23T10:20:00+09:00",
        accountingDate: "2026-07-23",
        sourceType: "kb-card",
        parser: { parserId: "kb-parser", parserVersion: "1" },
        rawPayloadHash: `sha256:${"1".repeat(64)}`,
      },
    };
    const legacyReceipt: CaptureSubmissionReceipt = {
      householdId: "household-1",
      rootIdempotencyKey: "legacy-processing-receipt",
      payloadFingerprint: "fingerprint",
      state: "processing",
      transaction: {
        stage: "terminal",
        downstreamKey: "payment-1",
        result: {
          kind: "recorded",
          transactionId: "transaction-1",
          editable: true,
          captureLineageId: "lineage-1",
          aggregateVersion: 1,
        },
      },
      balance: { stage: "absent" },
    };
    const saved: CaptureSubmissionReceipt[] = [];
    let transactionAttempts = 0;
    let balanceAttempts = 0;
    const subject = createCaptureBranchSubmissionApplication({
      receipts: {
        claim: async () => ({ kind: "existing", receipt: legacyReceipt }),
        save: async (receipt) => {
          saved.push(receipt);
        },
      },
      payloads: { fingerprint: () => "fingerprint" },
      transactions: {
        record: async () => {
          transactionAttempts += 1;
          throw new Error("terminal branch는 재호출하면 안 됩니다.");
        },
      },
      balances: {
        recordBalanceObservation: async () => {
          balanceAttempts += 1;
          throw new Error("absent branch는 호출하면 안 됩니다.");
        },
      },
    });

    const result = await subject.submit(envelope);

    expect(result).toEqual({
      kind: "accepted",
      completion: "terminal",
      transactionResult: {
        kind: "recorded",
        transactionId: "transaction-1",
        editable: true,
        captureLineageId: "lineage-1",
        aggregateVersion: 1,
      },
    });
    expect(transactionAttempts).toBe(0);
    expect(balanceAttempts).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ state: "completed" });
  });
});
