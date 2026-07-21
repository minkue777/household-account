import { describe, expect, it } from "vitest";
import {
  createAndroidCaptureFollowUpDriver,
  type AndroidCaptureFollowUpInputPort,
  type AndroidCaptureFollowUpState,
} from "../../../support/capture-follow-up-driver";

export interface AndroidCaptureFollowUpContractSubject
  extends AndroidCaptureFollowUpInputPort {
  state(): AndroidCaptureFollowUpState;
}

export function createSubject(): AndroidCaptureFollowUpContractSubject {
  return createAndroidCaptureFollowUpDriver();
}

const noFollowUpState = (): AndroidCaptureFollowUpState => ({
  quickEditTransactionIds: [],
  completionBroadcastTransactionIds: [],
  automaticPushIntents: [],
});

describe("Android 승인 creator·QuickEdit 후속 효과 공개 계약", () => {
  it("[T-ING-FOLLOWUP-001][ING-SAVE-006] creator가 없으면 저장 우회나 알림 생략 성공이 아니라 명시적 거부다", () => {
    const subject = createSubject();

    expect(
      subject.finalize({
        transactionResult: {
          kind: "created",
          transactionId: "transaction-1",
          editable: true,
        },
        receiptConfirmed: true,
      }),
    ).toEqual({ kind: "Rejected", code: "CREATOR_MEMBER_REQUIRED" });
    expect(subject.state()).toEqual(noFollowUpState());
  });

  it.each([
    {
      name: "신규 거래",
      transactionResult: {
        kind: "created" as const,
        transactionId: "transaction-created",
        editable: true as const,
        creatorMemberId: "member-1",
      },
      transactionId: "transaction-created",
    },
    {
      name: "편집 가능한 중복 결과",
      transactionResult: {
        kind: "duplicate" as const,
        existingTransactionId: "transaction-existing",
        editable: true,
      },
      transactionId: "transaction-existing",
    },
  ])(
    "[T-ING-FOLLOWUP-001][ING-SAVE-006] receipt가 확정된 $name만 QuickEdit과 완료 broadcast를 만든다",
    ({ transactionResult, transactionId }) => {
      const subject = createSubject();

      expect(
        subject.finalize({
          transactionResult,
          receiptConfirmed: true,
        }),
      ).toEqual({ kind: "Completed", editableTransactionId: transactionId });
      expect(subject.state()).toEqual({
        quickEditTransactionIds: [transactionId],
        completionBroadcastTransactionIds: [transactionId],
        automaticPushIntents: [],
      });
    },
  );

  it.each([
    {
      name: "편집 불가능 중복",
      transactionResult: {
        kind: "duplicate" as const,
        existingTransactionId: "transaction-existing",
        editable: false,
      },
      receiptConfirmed: true,
      expectedResult: { kind: "Completed" as const },
    },
    {
      name: "업무 거부",
      transactionResult: {
        kind: "rejected" as const,
        code: "CARD_NOT_REGISTERED_FOR_ACTOR",
      },
      receiptConfirmed: true,
      expectedResult: { kind: "Completed" as const },
    },
    {
      name: "서버 재시도 필요",
      transactionResult: {
        kind: "retryableFailure" as const,
        code: "LEDGER_UNAVAILABLE",
      },
      receiptConfirmed: false,
      expectedResult: { kind: "PendingRetry" as const },
    },
  ])(
    "[T-ING-FOLLOWUP-001][ING-SAVE-006] $name 결과에서는 QuickEdit·완료 broadcast·자동 push를 만들지 않는다",
    ({ transactionResult, receiptConfirmed, expectedResult }) => {
      const subject = createSubject();

      expect(
        subject.finalize({ transactionResult, receiptConfirmed }),
      ).toEqual(expectedResult);
      expect(subject.state()).toEqual(noFollowUpState());
    },
  );

  it("[T-ING-FOLLOWUP-001][ING-SAVE-006] 공백 creator도 누락과 동일하게 거부한다", () => {
    const subject = createSubject();

    expect(
      subject.finalize({
        transactionResult: {
          kind: "created",
          transactionId: "transaction-blank-creator",
          editable: true,
          creatorMemberId: "   ",
        },
        receiptConfirmed: true,
      }),
    ).toEqual({ kind: "Rejected", code: "CREATOR_MEMBER_REQUIRED" });
    expect(subject.state()).toEqual(noFollowUpState());
  });

  it.each([
    {
      name: "신규 거래",
      transactionResult: {
        kind: "created" as const,
        transactionId: "transaction-unconfirmed",
        editable: true as const,
        creatorMemberId: "member-1",
      },
    },
    {
      name: "편집 가능한 중복",
      transactionResult: {
        kind: "duplicate" as const,
        existingTransactionId: "transaction-existing-unconfirmed",
        editable: true,
      },
    },
  ])(
    "[T-ING-FOLLOWUP-001][ING-SAVE-006] receipt 미확정 $name 결과는 재시도 대기하며 후속 효과를 만들지 않는다",
    ({ transactionResult }) => {
      const subject = createSubject();

      expect(
        subject.finalize({ transactionResult, receiptConfirmed: false }),
      ).toEqual({ kind: "PendingRetry" });
      expect(subject.state()).toEqual(noFollowUpState());
    },
  );
});
