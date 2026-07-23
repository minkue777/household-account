import { describe, expect, it } from "vitest";

import { createCaptureBranchSubmissionApplication } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import type { CaptureBranchEnvelope } from "../../../../src/contexts/payment-capture/android-payment-ingestion/public";
import type { CaptureSubmissionReceipt } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";

describe("Capture branch 최종 receipt 복구", () => {
  it("일반 Android 승인은 ledger의 원자 receipt만 사용하고 중복 root receipt I/O를 생략한다", async () => {
    const envelope: CaptureBranchEnvelope = {
      rootIdempotencyKey: "android-approval-1",
      householdId: "household-1",
      captureEnvelopeIdentity: {
        contractVersion: "capture-envelope.v1",
        observationId: "observation-1",
        originChannel: "android-notification",
        sourceIdentity: "android-source",
        observedAt: "2026-07-23T10:20:00+09:00",
        parserId: "kb-parser",
        parserVersion: "1",
        rawPayloadHash: `sha256:${"1".repeat(64)}`,
      },
      transactionBranch: {
        branchKey: "payment-1",
        merchant: "가맹점",
        amountInWon: 10_000,
        occurredAt: "2026-07-23T10:20:00+09:00",
        accountingDate: "2026-07-23",
        sourceType: "kb-card",
        parser: { parserId: "kb-parser", parserVersion: "1" },
        rawPayloadHash: `sha256:${"1".repeat(64)}`,
        captureContext: {
          observationId: "observation-1",
          observationType: "approval",
          originChannel: "android-notification",
          creatorMemberId: "member-1",
          cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
        },
      },
    };
    let receiptIo = 0;
    let receivedDownstreamKey = "";
    const subject = createCaptureBranchSubmissionApplication({
      receipts: {
        claim: async () => {
          receiptIo += 1;
          throw new Error("Android 승인 hot path에서 root receipt를 읽으면 안 됩니다.");
        },
        save: async () => {
          receiptIo += 1;
        },
      },
      payloads: { fingerprint: () => "unused" },
      transactions: {
        record: async (command) => {
          receivedDownstreamKey = command.downstreamKey;
          return {
            kind: "recorded",
            transactionId: "transaction-1",
            editable: true,
            captureLineageId: "lineage-1",
            aggregateVersion: 1,
          };
        },
      },
      balances: {
        recordBalanceObservation: async () => {
          throw new Error("balance branch가 없습니다.");
        },
      },
    });

    expect(await subject.submit(envelope)).toMatchObject({
      kind: "accepted",
      completion: "terminal",
      transactionResult: { kind: "recorded", transactionId: "transaction-1" },
    });
    expect(receivedDownstreamKey).toBe("android-approval-1");
    expect(receiptIo).toBe(0);
  });

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
