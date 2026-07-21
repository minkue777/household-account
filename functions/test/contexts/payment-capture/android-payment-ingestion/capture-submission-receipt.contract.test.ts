import { describe, expect, it } from "vitest";
import {
  createCaptureSubmissionReceiptDriver,
  type CaptureSubmissionCommand,
  type CaptureSubmissionContractState,
  type CaptureSubmissionInputPort,
  type CaptureSubmissionOutcome,
  type CaptureSubmissionReceiptFixture,
  type CaptureSubmissionResult,
  type PublishedEventView,
  type SeedCapturedTransaction,
} from "../../../support/capture-submission-receipt-driver";

export interface CaptureSubmissionReceiptSubject
  extends CaptureSubmissionInputPort {
  state(): CaptureSubmissionContractState;
}

export function createSubject(
  fixture: CaptureSubmissionReceiptFixture = {},
): CaptureSubmissionReceiptSubject {
  return createCaptureSubmissionReceiptDriver(fixture);
}

function approvalCommand(input: {
  rootIdempotencyKey: string;
  originChannel: "android-notification" | "ios-shortcut";
  observationId?: string;
  amountInWon?: number;
  merchant?: string;
  card?: { companyLabel: string; maskedToken: string };
  balance?: {
    branchId: string;
    currencyType: "gyeonggi" | "daejeon" | "sejong";
    balanceInWon: number;
    observedAt: string;
  };
}): CaptureSubmissionCommand {
  return {
    actor: {
      principalId: "principal-1",
      householdId: "household-1",
      actingMemberId: "member-1",
      capabilities: ["paymentCapture:submit"],
    },
    rootIdempotencyKey: input.rootIdempotencyKey,
    envelope: {
      contractVersion: "capture-envelope.v1",
      observationId:
        input.observationId ?? `observation-${input.rootIdempotencyKey}`,
      originChannel: input.originChannel,
      sourceEvidence:
        input.originChannel === "android-notification"
          ? {
              kind: "android-registered-package",
              sourceType: "kb-card",
              packageName: "com.kbcard.cxh.appcard",
              registryVersion: "source-registry.v1",
            }
          : {
              kind: "ios-shortcut-credential",
              sourceType: "ios-shortcut",
              credentialIdHash:
                "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            },
      observedAt: "2026-07-19T10:05:01+09:00",
      parser: {
        parserId:
          input.originChannel === "android-notification"
            ? "kb-parser"
            : "shortcut-parser",
        parserVersion: "1",
      },
      rawPayloadHash:
        "sha256:6666666666666666666666666666666666666666666666666666666666666666",
      paymentObservation: {
        branchId: `payment-${input.observationId ?? input.rootIdempotencyKey}`,
        observationType: "approval",
        amountInWon: input.amountInWon ?? 12_000,
        occurredLocalDate: "2026-07-19",
        occurredLocalTime: "10:05",
        zoneId: "Asia/Seoul",
        merchantEvidence: { rawCandidate: input.merchant ?? "가맹점 A" },
        cardEvidence: input.card ?? {
          companyLabel: "국민",
          maskedToken: "1234",
        },
      },
      ...(input.balance === undefined
        ? {}
        : { balanceObservation: input.balance }),
    },
  };
}

function cancellationCommand(
  rootIdempotencyKey: string,
): CaptureSubmissionCommand {
  const command = approvalCommand({
    rootIdempotencyKey,
    originChannel: "android-notification",
  });
  const paymentObservation = command.envelope.paymentObservation;
  if (paymentObservation === undefined) {
    throw new Error("취소 명령에는 payment observation이 필요합니다.");
  }

  return {
    ...command,
    envelope: {
      ...command.envelope,
      paymentObservation: {
        ...paymentObservation,
        observationType: "cancellation",
      },
    },
  };
}

function successValue(outcome: CaptureSubmissionOutcome): CaptureSubmissionResult {
  if (outcome.kind !== "success") {
    throw new Error(`성공 결과가 필요하지만 ${outcome.kind} 결과를 받았습니다.`);
  }
  return outcome.value;
}

function requiredTransactionResult(outcome: CaptureSubmissionOutcome) {
  const result = successValue(outcome).transactionResult;
  if (result === undefined) {
    throw new Error("거래 branch 결과가 필요합니다.");
  }
  return result;
}

function transactionRecordedEvents(
  state: CaptureSubmissionContractState,
): readonly PublishedEventView[] {
  return state.events.filter(
    ({ eventType }) => eventType === "TransactionRecorded.v1",
  );
}

describe("Capture receipt·fingerprint·동시성 공개 계약", () => {
  it("[T-ING-AUTH-001][ING-SAVE-001] 제출 capability가 없으면 root receipt와 downstream 상태를 만들지 않는다", async () => {
    const subject = createSubject();
    const command = approvalCommand({
      rootIdempotencyKey: "unauthorized-request",
      originChannel: "android-notification",
    });

    expect(
      await subject.submit({
        ...command,
        actor: { ...command.actor, capabilities: [] },
      }),
    ).toEqual({ kind: "Forbidden", code: "CAPABILITY_REQUIRED" });
    expect(subject.state()).toMatchObject({
      transactions: [],
      cancelledLineageIds: [],
      balances: [],
      receipts: [],
      events: [],
      downstreamAttempts: { transaction: 0, balance: 0 },
    });
  });
  it("[T-IOS-001][IOS-011] 같은 root key·payload의 동시 승인은 같은 Created 결과를 재생하고 거래와 Event를 한 건만 만든다", async () => {
    const subject = createSubject();
    const command = approvalCommand({
      rootIdempotencyKey: "same-request",
      originChannel: "ios-shortcut",
    });

    const outcomes = await Promise.all([
      subject.submit(command),
      subject.submit(command),
    ]);

    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(requiredTransactionResult(outcomes[0]).kind).toBe("created");
    const state = subject.state();
    expect(state.transactions).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.receipts[0]).toMatchObject({
      householdId: "household-1",
      rootIdempotencyKey: "same-request",
      state: "completed",
      transactionBranch: {
        branchId: command.envelope.paymentObservation?.branchId,
        downstreamKey: expect.any(String),
        stage: "terminal",
        result: successValue(outcomes[0]).transactionResult,
      },
    });
    expect(state.receipts[0].transactionBranch.downstreamKey).not.toBe("");
    expect(transactionRecordedEvents(state)).toHaveLength(1);
  });

  it("[T-IOS-001][IOS-011] 같은 root key의 서로 다른 payload가 동시에 오면 하나만 확정하고 다른 하나는 충돌한다", async () => {
    const subject = createSubject();
    const first = approvalCommand({
      rootIdempotencyKey: "conflicting-request",
      originChannel: "ios-shortcut",
      observationId: "first-payload",
      amountInWon: 12_000,
    });
    const second = approvalCommand({
      rootIdempotencyKey: "conflicting-request",
      originChannel: "ios-shortcut",
      observationId: "second-payload",
      amountInWon: 13_000,
    });

    const outcomes = await Promise.all([
      subject.submit(first),
      subject.submit(second),
    ]);

    expect(outcomes.filter(({ kind }) => kind === "success")).toHaveLength(1);
    expect(outcomes.filter(({ kind }) => kind === "conflict")).toEqual([
      { kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" },
    ]);
    const state = subject.state();
    expect(state.transactions).toHaveLength(1);
    expect([12_000, 13_000]).toContain(state.transactions[0].amountInWon);
    expect(state.receipts).toHaveLength(1);
    expect(transactionRecordedEvents(state)).toHaveLength(1);
  });

  it("[T-ING-BAL-001][ING-009] 한 branch만 retryable이면 root는 partial이고 같은 key 재시도는 완료된 거래를 재호출하지 않는다", async () => {
    const subject = createSubject({
      balanceOutcomes: ["retryable-failure", "recorded"],
    });
    const command = approvalCommand({
      rootIdempotencyKey: "partial-request",
      originChannel: "android-notification",
      balance: {
        branchId: "balance-partial-request",
        currencyType: "gyeonggi",
        balanceInWon: 55_000,
        observedAt: "2026-07-19T10:05:01+09:00",
      },
    });

    const first = await subject.submit(command);
    const afterFirst = subject.state();
    const firstResult = successValue(first);

    expect(first).toMatchObject({
      kind: "success",
      value: {
        completion: "partial-retryable",
        transactionResult: { kind: "created" },
        balanceResult: {
          kind: "retryableFailure",
          code: "BALANCE_REPOSITORY_UNAVAILABLE",
        },
      },
    });
    expect(afterFirst.receipts[0]).toMatchObject({
      state: "partial-retryable",
      transactionBranch: { stage: "terminal", result: { kind: "created" } },
      balanceBranch: {
        stage: "retryable",
        downstreamKey: "balance-partial-request",
        result: { kind: "retryableFailure" },
      },
    });
    expect(afterFirst.downstreamAttempts).toEqual({
      transaction: 1,
      balance: 1,
    });

    const replay = await subject.submit(command);
    const completed = subject.state();

    expect(replay).toMatchObject({
      kind: "success",
      value: {
        completion: "terminal",
        transactionResult: firstResult.transactionResult,
        balanceResult: { kind: "recorded", balanceVersion: 1 },
      },
    });
    expect(completed.transactions).toEqual(afterFirst.transactions);
    expect(completed.receipts[0]).toMatchObject({
      state: "completed",
      transactionBranch: afterFirst.receipts[0].transactionBranch,
      balanceBranch: {
        stage: "terminal",
        downstreamKey:
          afterFirst.receipts[0].balanceBranch?.downstreamKey,
        result: { kind: "recorded", balanceVersion: 1 },
      },
    });
    expect(completed.downstreamAttempts).toEqual({
      transaction: 1,
      balance: 2,
    });
    expect(transactionRecordedEvents(completed)).toHaveLength(1);
  });

  it("[T-DUP-001][ING-SAVE-005][IOS-006] Android와 Shortcut이 다른 key·카드·source로 같은 결제를 동시에 제출해도 fingerprint 거래는 한 건이다", async () => {
    const subject = createSubject();
    const android = approvalCommand({
      rootIdempotencyKey: "android-request",
      originChannel: "android-notification",
      card: { companyLabel: "국민", maskedToken: "1234" },
    });
    const shortcut = approvalCommand({
      rootIdempotencyKey: "shortcut-request",
      originChannel: "ios-shortcut",
      merchant: "  가맹점   A ",
      card: { companyLabel: "농협", maskedToken: "9999" },
    });

    const outcomes = await Promise.all([
      subject.submit(android),
      subject.submit(shortcut),
    ]);
    const results = outcomes.map(requiredTransactionResult);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "created",
      "duplicate",
    ]);
    const created = results.find(({ kind }) => kind === "created");
    const duplicate = results.find(({ kind }) => kind === "duplicate");
    expect(created?.kind).toBe("created");
    expect(duplicate?.kind).toBe("duplicate");
    if (created?.kind === "created" && duplicate?.kind === "duplicate") {
      expect(duplicate.existingTransactionId).toBe(created.transactionId);
    }
    const state = subject.state();
    expect(state.transactions).toHaveLength(1);
    expect(state.receipts).toHaveLength(2);
    expect(transactionRecordedEvents(state)).toHaveLength(1);
  });

  it("[T-CAPTURE-LINEAGE-001][CAN-007] 성공한 취소 branch는 terminal receipt를 남겨 같은 요청 재시도에도 동일 Cancelled 결과를 재생한다", async () => {
    const existing: SeedCapturedTransaction = {
      transactionId: "transaction-existing",
      householdId: "household-1",
      creatorMemberId: "member-1",
      amountInWon: 12_000,
      occurredLocalDate: "2026-07-19",
      occurredLocalTime: "10:05",
      merchant: "가맹점 A",
      captureLineageId: "lineage-existing",
      cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
    };
    const subject = createSubject({ existingTransactions: [existing] });
    const command = cancellationCommand("cancel-request");

    const first = await subject.submit(command);
    const replay = await subject.submit(command);

    expect(replay).toEqual(first);
    expect(successValue(first).transactionResult).toEqual({
      kind: "cancelled",
      transactionIds: ["transaction-existing"],
    });
    const state = subject.state();
    expect(state.transactions).toEqual([]);
    expect(state.cancelledLineageIds).toEqual(["lineage-existing"]);
    expect(state.receipts).toHaveLength(1);
    expect(state.receipts[0]).toMatchObject({
      rootIdempotencyKey: "cancel-request",
      state: "completed",
      transactionBranch: {
        stage: "terminal",
        result: successValue(first).transactionResult,
      },
    });
  });

  it("[T-CAN-002][CAN-003][DEC-031] 원거래 없는 취소도 NotFound receipt를 재생하지만 미래 승인을 막는 상태는 만들지 않는다", async () => {
    const subject = createSubject();
    const cancellation = cancellationCommand("cancel-before-approval");

    const first = await subject.submit(cancellation);
    const replay = await subject.submit(cancellation);

    expect(replay).toEqual(first);
    expect(successValue(first).transactionResult).toEqual({
      kind: "notFound",
      resource: "cancellationTarget",
    });
    expect(subject.state()).toMatchObject({
      transactions: [],
      cancelledLineageIds: [],
      receipts: [
        {
          rootIdempotencyKey: "cancel-before-approval",
          transactionBranch: {
            stage: "terminal",
            result: {
              kind: "notFound",
              resource: "cancellationTarget",
            },
          },
        },
      ],
    });

    const approval = await subject.submit(
      approvalCommand({
        rootIdempotencyKey: "later-approval",
        originChannel: "android-notification",
      }),
    );

    expect(requiredTransactionResult(approval).kind).toBe("created");
    expect(subject.state().transactions).toHaveLength(1);
  });
});
