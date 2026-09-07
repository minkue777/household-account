import { afterEach, describe, expect, it, vi } from "vitest";

import { createCaptureBranchSubmissionApplication } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import type { CaptureBranchEnvelope, CaptureTransactionBranchResult } from "../../../../src/contexts/payment-capture/android-payment-ingestion/public";
import type { CaptureSubmissionReceipt } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";
import type { CaptureTransactionGatewayPort } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureTransactionGatewayPort";
import type { BalanceObservationIntakeInputPort } from "../../../../src/contexts/household-finance/local-currency/public";
import { InMemoryCaptureSubmissionReceiptStore } from "../../../support/capture-branch-receipt-fixture";

const compositeEnvelope: CaptureBranchEnvelope = {
  householdId: "household-1",
  rootIdempotencyKey: "composite-1",
  transactionBranch: {
    branchKey: "payment-1",
    merchant: "가맹점",
    amountInWon: 10_000,
    occurredAt: "2026-07-23T10:20:00+09:00",
    accountingDate: "2026-07-23",
    sourceType: "gyeonggi-local-currency",
    parser: { parserId: "local-currency-parser", parserVersion: "1" },
    rawPayloadHash: `sha256:${"1".repeat(64)}`,
  },
  balanceBranch: {
    branchKey: "balance-1",
    observation: {
      contractVersion: "balance-observation.v1",
      observationId: "balance-1",
      localCurrencyType: "gyeonggi",
      balanceInWon: 20_000,
      observedAt: "2026-07-23T10:20:00+09:00",
      sourceType: "gyeonggi-local-currency",
      parser: { parserId: "local-currency-parser", parserVersion: "1" },
    },
  },
};
const recordedTransaction = {
  kind: "recorded",
  transactionId: "transaction-1",
  editable: true,
  captureLineageId: "lineage-1",
  aggregateVersion: 1,
} as const satisfies CaptureTransactionBranchResult;
const recordedBalance = {
  kind: "success",
  status: "created",
  balanceId: "balance-1",
  balanceVersion: 1,
} as const;

function delayed<T>(value: T, milliseconds: number): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), milliseconds));
}

function compositeSubject() {
  const receipts = new InMemoryCaptureSubmissionReceiptStore();
  const save = vi.spyOn(receipts, "save");
  const recordTransaction = vi.fn<CaptureTransactionGatewayPort["record"]>()
    .mockResolvedValue(recordedTransaction);
  const recordBalance = vi.fn<BalanceObservationIntakeInputPort["recordBalanceObservation"]>()
    .mockResolvedValue(recordedBalance);
  return {
    receipts,
    save,
    recordTransaction,
    recordBalance,
    subject: createCaptureBranchSubmissionApplication({
      receipts,
      payloads: { fingerprint: () => "fingerprint" },
      transactions: { record: recordTransaction },
      balances: { recordBalanceObservation: recordBalance },
    }),
  };
}

afterEach(() => vi.useRealTimers());

describe("Capture branch 최종 receipt 복구", () => {
  it.each(["transaction", "balance"] as const)(
    "%s이 먼저 끝나도 두 branch는 함께 시작하고 늦은 결과까지 기다려 300ms 대신 200ms에 한 번 확정한다",
    async first => {
      vi.useFakeTimers();
      const { subject, save, recordTransaction, recordBalance } = compositeSubject();
      recordTransaction.mockImplementation(() => delayed(recordedTransaction, first === "transaction" ? 100 : 200));
      recordBalance.mockImplementation(() => delayed(recordedBalance, first === "balance" ? 100 : 200));
      let finished = false;
      const pending = subject.submit(compositeEnvelope).then(result => {
        finished = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(recordTransaction).toHaveBeenCalledTimes(1);
      expect(recordBalance).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(finished).toBe(false);
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toMatchObject({
        completion: "terminal",
        transactionResult: recordedTransaction,
        balanceResult: { kind: "recorded", balanceVersion: 1 },
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0]).toMatchObject({
        state: "completed",
        transaction: { stage: "terminal", downstreamKey: "payment-1" },
        balance: { stage: "terminal", downstreamKey: "balance-1" },
      });
    },
  );

  it.each(["transaction", "balance"] as const)(
    "%s의 예상 밖 예외도 다른 branch의 완료를 기다리고 실패한 branch만 같은 key로 재시도한다",
    async failed => {
      vi.useFakeTimers();
      const { subject, save, recordTransaction, recordBalance } = compositeSubject();
      if (failed === "transaction") {
        recordTransaction.mockImplementationOnce(() => { throw new Error("unexpected ledger failure"); });
        recordBalance.mockImplementationOnce(() => delayed(recordedBalance, 100));
      } else {
        recordBalance.mockImplementationOnce(() => { throw new Error("unexpected balance failure"); });
        recordTransaction.mockImplementationOnce(() => delayed(recordedTransaction, 100));
      }
      const pending = subject.submit(compositeEnvelope);
      await vi.advanceTimersByTimeAsync(0);
      expect(recordTransaction).toHaveBeenCalledTimes(1);
      expect(recordBalance).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toMatchObject({
        completion: "partial-retryable",
        [`${failed}Result`]: {
          kind: "retryable-failure",
          code: failed === "transaction" ? "LEDGER_UNAVAILABLE" : "BALANCE_REPOSITORY_UNAVAILABLE",
        },
      });
      expect(await subject.submit(compositeEnvelope)).toMatchObject({ completion: "terminal" });
      expect(recordTransaction).toHaveBeenCalledTimes(failed === "transaction" ? 2 : 1);
      expect(recordBalance).toHaveBeenCalledTimes(failed === "balance" ? 2 : 1);
      expect(recordTransaction.mock.calls.map(([command]) => command.downstreamKey))
        .toEqual(failed === "transaction" ? ["payment-1", "payment-1"] : ["payment-1"]);
      expect(recordBalance.mock.calls.map(([, observation]) => observation.observationId))
        .toEqual(failed === "balance" ? ["balance-1", "balance-1"] : ["balance-1"]);
    },
  );

  it("root claim 충돌은 두 branch를 모두 호출하지 않는다", async () => {
    const { subject, receipts, save, recordTransaction, recordBalance } = compositeSubject();
    vi.spyOn(receipts, "claim").mockResolvedValue({ kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect(await subject.submit(compositeEnvelope)).toEqual({ kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect(recordTransaction).not.toHaveBeenCalled();
    expect(recordBalance).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("동시 실행이 먼저 저장한 실제 terminal receipt로 응답하고 로컬 재시도 실패를 반환하지 않는다", async () => {
    const { subject, save, recordTransaction } = compositeSubject();
    recordTransaction.mockResolvedValue({ kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" });
    save.mockImplementation(async candidate => {
      expect(candidate.state).toBe("partial-retryable");
      return {
        ...candidate,
        state: "completed",
        transaction: { stage: "terminal", downstreamKey: "payment-1", result: recordedTransaction },
      };
    });
    expect(await subject.submit(compositeEnvelope)).toMatchObject({
      kind: "accepted",
      completion: "terminal",
      transactionResult: recordedTransaction,
    });
  });

  it("두 branch가 끝나도 root commit 전에 성공 응답하지 않으며 저장 실패는 전파하고 원래 key로 복구한다", async () => {
    vi.useFakeTimers();
    const { subject, save, recordTransaction, recordBalance } = compositeSubject();
    save.mockImplementationOnce(async () => {
      await delayed(undefined, 100);
      throw new Error("root commit unavailable");
    });
    let finished = false;
    const pending = subject.submit(compositeEnvelope).finally(() => { finished = true; });
    const rejection = expect(pending).rejects.toThrow("root commit unavailable");
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(await subject.submit(compositeEnvelope)).toMatchObject({ completion: "terminal" });
    expect(recordTransaction.mock.calls.map(([command]) => command.downstreamKey)).toEqual(["payment-1", "payment-1"]);
    expect(recordBalance.mock.calls.map(([, observation]) => observation.observationId)).toEqual(["balance-1", "balance-1"]);
    expect(save).toHaveBeenCalledTimes(2);
  });

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
        save: async (receipt) => {
          receiptIo += 1;
          return receipt;
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
          return receipt;
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
