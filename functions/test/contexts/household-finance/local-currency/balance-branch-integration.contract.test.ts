import { describe, expect, it } from "vitest";
import {
  createBalanceBranchIntegrationDriver,
  type BalanceBranchIntegrationDriver,
  type BalanceBranchIntegrationFixture,
  type CaptureBranchEnvelope,
} from "../../../support/balance-branch-integration-driver";

export interface BalanceBranchIntegrationSubject
  extends BalanceBranchIntegrationDriver {}

export function createSubject(
  fixture: BalanceBranchIntegrationFixture,
): BalanceBranchIntegrationSubject {
  return createBalanceBranchIntegrationDriver(fixture);
}

const balanceOnlyEnvelope: CaptureBranchEnvelope = {
  rootIdempotencyKey: "android:installation-1:observation-1",
  householdId: "house-1",
  balanceBranch: {
    branchKey: "android:installation-1:observation-1:balance",
    observation: {
      contractVersion: "balance-observation.v1",
      observationId: "observation-1:balance",
      localCurrencyType: "gyeonggi",
      balanceInWon: 123_456,
      observedAt: "2026-07-20T09:00:00+09:00",
      sourceType: "gyeonggi-local-currency",
      parser: {
        parserId: "gyeonggi-local-currency-parser",
        parserVersion: "1.0.0",
      },
    },
  },
};

const combinedEnvelope: CaptureBranchEnvelope = {
  ...balanceOnlyEnvelope,
  rootIdempotencyKey: "android:installation-1:observation-2",
  transactionBranch: {
    branchKey: "android:installation-1:observation-2:transaction",
    merchant: "가맹점",
    amountInWon: 10_000,
    occurredAt: "2026-07-20T09:00:00+09:00",
    accountingDate: "2026-07-20",
    sourceType: "gyeonggi-local-currency",
    parser: {
      parserId: "gyeonggi-local-currency-parser",
      parserVersion: "1.0.0",
    },
    rawPayloadHash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  balanceBranch: {
    ...balanceOnlyEnvelope.balanceBranch!,
    branchKey: "android:installation-1:observation-2:balance",
    observation: {
      ...balanceOnlyEnvelope.balanceBranch!.observation,
      observationId: "observation-2:balance",
    },
  },
};

describe("Payment Capture와 Local Currency 독립 branch 종단 계약", () => {
  it("[T-BAL-008][T-ING-BAL-001][BAL-005] balance-only 입력은 카드 설정·Ledger 없이 Balance와 receipt만 확정한다", async () => {
    const subject = createSubject({ balanceOutcomes: ["recorded"] });

    const result = await subject.submit(balanceOnlyEnvelope);

    expect(result).toEqual({
      kind: "accepted",
      completion: "terminal",
      balanceResult: {
        kind: "recorded",
        status: "created",
        balanceId: expect.any(String),
        balanceVersion: 1,
      },
    });
    const state = await subject.snapshot();
    expect(state.ledgerTransactions).toEqual([]);
    expect(state.balances).toEqual([
      expect.objectContaining({
        householdId: "house-1",
        localCurrencyType: "gyeonggi",
        balanceInWon: 123_456,
        balanceVersion: 1,
      }),
    ]);
    expect(state.receipts).toEqual([
      {
        rootIdempotencyKey: balanceOnlyEnvelope.rootIdempotencyKey,
        transaction: { stage: "absent" },
        balance: {
          stage: "terminal",
          downstreamKey: balanceOnlyEnvelope.balanceBranch?.branchKey,
          resultKind: "recorded",
        },
      },
    ]);
    expect(state.downstreamAttempts).toEqual({ transaction: 0, balance: 1 });
    expect(state.events).toEqual([
      {
        eventType: "LocalCurrencyBalanceChanged.v1",
        aggregateId: expect.any(String),
      },
    ]);
  });

  it("[T-BAL-008][T-ING-BAL-001][BAL-005] 카드 미등록으로 거래가 거부돼도 유효한 잔액은 terminal 성공으로 남는다", async () => {
    const subject = createSubject({
      transactionOutcomes: ["registered-card-rejected"],
      balanceOutcomes: ["recorded"],
    });

    const result = await subject.submit(combinedEnvelope);

    expect(result).toEqual({
      kind: "accepted",
      completion: "terminal",
      transactionResult: {
        kind: "rejected",
        code: "CARD_NOT_REGISTERED_FOR_ACTOR",
      },
      balanceResult: {
        kind: "recorded",
        status: "created",
        balanceId: expect.any(String),
        balanceVersion: 1,
      },
    });
    const state = await subject.snapshot();
    expect(state.ledgerTransactions).toEqual([]);
    expect(state.balances).toHaveLength(1);
    expect(state.receipts[0]).toMatchObject({
      transaction: { stage: "terminal", resultKind: "rejected" },
      balance: { stage: "terminal", resultKind: "recorded" },
    });
  });

  it("[T-BAL-008][T-ING-BAL-001][BAL-005] 거래 성공·잔액 일시 실패 후 재시도는 Ledger를 다시 호출하지 않고 잔액만 완성한다", async () => {
    const subject = createSubject({
      transactionOutcomes: ["recorded"],
      balanceOutcomes: ["retryable-failure", "recorded"],
    });

    const first = await subject.submit(combinedEnvelope);
    const afterFirst = await subject.snapshot();
    const second = await subject.submit(combinedEnvelope);

    expect(first).toMatchObject({
      kind: "accepted",
      completion: "partial-retryable",
      transactionResult: { kind: "recorded" },
      balanceResult: {
        kind: "retryable-failure",
        code: "BALANCE_REPOSITORY_UNAVAILABLE",
      },
    });
    expect(afterFirst.ledgerTransactions).toHaveLength(1);
    expect(afterFirst.balances).toEqual([]);
    expect(afterFirst.receipts[0]).toMatchObject({
      transaction: { stage: "terminal", resultKind: "recorded" },
      balance: { stage: "retryable", resultKind: "retryable-failure" },
    });
    expect(second).toMatchObject({
      kind: "accepted",
      completion: "terminal",
      transactionResult: { kind: "recorded" },
      balanceResult: {
        kind: "recorded",
        status: "created",
        balanceVersion: 1,
      },
    });
    const finalState = await subject.snapshot();
    expect(finalState.ledgerTransactions).toEqual(afterFirst.ledgerTransactions);
    expect(finalState.balances).toHaveLength(1);
    expect(finalState.downstreamAttempts).toEqual({
      transaction: 1,
      balance: 2,
    });
    expect(
      finalState.events.filter(
        ({ eventType }) => eventType === "TransactionRecorded.v1",
      ),
    ).toHaveLength(1);
  });

  it("[T-BAL-008][T-ING-BAL-001][BAL-005] 거래 일시 실패·잔액 성공 후 재시도는 Balance를 다시 호출하거나 version을 늘리지 않는다", async () => {
    const subject = createSubject({
      transactionOutcomes: ["retryable-failure", "recorded"],
      balanceOutcomes: ["recorded"],
    });

    const first = await subject.submit(combinedEnvelope);
    const afterFirst = await subject.snapshot();
    const second = await subject.submit(combinedEnvelope);

    expect(first).toMatchObject({
      kind: "accepted",
      completion: "partial-retryable",
      transactionResult: {
        kind: "retryable-failure",
        code: "LEDGER_UNAVAILABLE",
      },
      balanceResult: {
        kind: "recorded",
        status: "created",
        balanceVersion: 1,
      },
    });
    expect(afterFirst.ledgerTransactions).toEqual([]);
    expect(afterFirst.balances).toHaveLength(1);
    expect(second).toMatchObject({
      kind: "accepted",
      completion: "terminal",
      transactionResult: { kind: "recorded" },
      balanceResult: { kind: "recorded", balanceVersion: 1 },
    });
    const finalState = await subject.snapshot();
    expect(finalState.balances).toEqual(afterFirst.balances);
    expect(finalState.downstreamAttempts).toEqual({
      transaction: 2,
      balance: 1,
    });
    expect(
      finalState.events.filter(
        ({ eventType }) => eventType === "LocalCurrencyBalanceChanged.v1",
      ),
    ).toHaveLength(1);
  });

  it("[T-BAL-008][T-ING-BAL-001][BAL-005] terminal envelope 재생은 두 branch의 최초 결과와 최종 상태를 그대로 재생한다", async () => {
    const subject = createSubject({
      transactionOutcomes: ["recorded"],
      balanceOutcomes: ["recorded"],
    });

    const first = await subject.submit(combinedEnvelope);
    const beforeReplay = await subject.snapshot();
    const replay = await subject.submit(combinedEnvelope);

    expect(replay).toEqual(first);
    expect(await subject.snapshot()).toEqual(beforeReplay);
    expect(beforeReplay.downstreamAttempts).toEqual({
      transaction: 1,
      balance: 1,
    });
  });

  it("[T-ING-BAL-001][ING-009] 같은 root key의 다른 payload는 충돌하며 terminal·retryable branch를 모두 호출하지 않는다", async () => {
    const subject = createSubject({
      transactionOutcomes: ["retryable-failure", "recorded"],
      balanceOutcomes: ["recorded"],
    });
    const first = await subject.submit(combinedEnvelope);
    const beforeConflict = await subject.snapshot();

    const conflict = await subject.submit({
      ...combinedEnvelope,
      transactionBranch: {
        ...combinedEnvelope.transactionBranch!,
        amountInWon: 10_001,
      },
    });

    expect(first).toMatchObject({ completion: "partial-retryable" });
    expect(conflict).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(await subject.snapshot()).toEqual(beforeConflict);

    const retry = await subject.submit(combinedEnvelope);
    expect(retry).toMatchObject({
      kind: "accepted",
      completion: "terminal",
      transactionResult: { kind: "recorded" },
      balanceResult: { kind: "recorded", balanceVersion: 1 },
    });
    expect((await subject.snapshot()).downstreamAttempts).toEqual({
      transaction: 2,
      balance: 1,
    });
  });
});
