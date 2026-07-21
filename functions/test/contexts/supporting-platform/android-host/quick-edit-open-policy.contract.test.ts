import { describe, expect, it } from "vitest";

import { createQuickEditOpenPolicyFixture } from "../../../support/quick-edit-open-policy-fixture";

export interface QuickEditOpenInput {
  transactionResult:
    | { kind: "created"; transactionId: string }
    | {
        kind: "duplicate";
        existingTransactionId: string;
        editable: boolean;
      }
    | { kind: "rejected" }
    | { kind: "retryableFailure" };
  saveReceiptConfirmed: boolean;
  quickEditEnabled?: boolean;
  overlayPermission: boolean;
  activeSession: boolean;
}

export type QuickEditOpenResult =
  | { kind: "Opened"; transactionId: string }
  | { kind: "Queued"; transactionId: string }
  | {
      kind: "Suppressed";
      reason:
        | "TRANSACTION_NOT_CONFIRMED"
        | "USER_DISABLED"
        | "OVERLAY_PERMISSION_MISSING"
        | "NO_ACTIVE_SESSION"
        | "TRANSACTION_NOT_EDITABLE";
    };

export interface QuickEditOpenSnapshot {
  activeTransactionId?: string;
  pendingTransactionIds: readonly string[];
}

export interface QuickEditOpenPolicyContractSubject {
  open(input: QuickEditOpenInput): QuickEditOpenResult;
  snapshot(): QuickEditOpenSnapshot;
}

export function createSubject(): QuickEditOpenPolicyContractSubject {
  return createQuickEditOpenPolicyFixture();
}

function validInput(
  overrides: Partial<QuickEditOpenInput> = {},
): QuickEditOpenInput {
  return {
    transactionResult: { kind: "created", transactionId: "transaction-1" },
    saveReceiptConfirmed: true,
    overlayPermission: true,
    activeSession: true,
    ...overrides,
  };
}

describe("자동 저장 후 QuickEdit 열기 공개 계약", () => {
  it("[T-QE-006][QE-001] 설정값이 없을 때 기본 true로 보고 저장 확정 거래를 연다", () => {
    const subject = createSubject();

    expect(subject.open(validInput())).toEqual({
      kind: "Opened",
      transactionId: "transaction-1",
    });
    expect(subject.snapshot()).toEqual({
      activeTransactionId: "transaction-1",
      pendingTransactionIds: [],
    });
  });

  it("[T-QE-006][QE-001] 편집 가능한 중복 결과도 기존 거래 ID로 연다", () => {
    const subject = createSubject();

    expect(
      subject.open(
        validInput({
          transactionResult: {
            kind: "duplicate",
            existingTransactionId: "transaction-existing",
            editable: true,
          },
        }),
      ),
    ).toEqual({ kind: "Opened", transactionId: "transaction-existing" });
  });

  it("[T-QE-006][QE-001] 다른 QuickEdit이 열려 있으면 새 확정 거래를 대기열에 넣고 현재 화면을 바꾸지 않는다", () => {
    const subject = createSubject();
    subject.open(validInput());

    expect(
      subject.open(
        validInput({
          transactionResult: {
            kind: "created",
            transactionId: "transaction-2",
          },
        }),
      ),
    ).toEqual({ kind: "Queued", transactionId: "transaction-2" });
    expect(subject.snapshot()).toEqual({
      activeTransactionId: "transaction-1",
      pendingTransactionIds: ["transaction-2"],
    });
  });

  it.each([
    {
      name: "저장 receipt 미확정",
      overrides: { saveReceiptConfirmed: false },
      reason: "TRANSACTION_NOT_CONFIRMED" as const,
    },
    {
      name: "저장 실패",
      overrides: {
        transactionResult: { kind: "retryableFailure" as const },
      },
      reason: "TRANSACTION_NOT_CONFIRMED" as const,
    },
    {
      name: "QuickEdit 설정 off",
      overrides: { quickEditEnabled: false },
      reason: "USER_DISABLED" as const,
    },
    {
      name: "overlay 권한 없음",
      overrides: { overlayPermission: false },
      reason: "OVERLAY_PERMISSION_MISSING" as const,
    },
    {
      name: "현재 session 없음",
      overrides: { activeSession: false },
      reason: "NO_ACTIVE_SESSION" as const,
    },
    {
      name: "편집 불가능 중복",
      overrides: {
        transactionResult: {
          kind: "duplicate" as const,
          existingTransactionId: "transaction-existing",
          editable: false,
        },
      },
      reason: "TRANSACTION_NOT_EDITABLE" as const,
    },
  ])(
    "[T-QE-006][QE-001] $name 상태에서는 QuickEdit을 열거나 대기시키지 않는다",
    ({ overrides, reason }) => {
      const subject = createSubject();

      expect(subject.open(validInput(overrides))).toEqual({
        kind: "Suppressed",
        reason,
      });
      expect(subject.snapshot()).toEqual({ pendingTransactionIds: [] });
    },
  );

  it("[T-QE-006][QE-001] 거부된 거래도 저장 확정 거래로 해석하지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.open(
        validInput({ transactionResult: { kind: "rejected" } }),
      ),
    ).toEqual({
      kind: "Suppressed",
      reason: "TRANSACTION_NOT_CONFIRMED",
    });
    expect(subject.snapshot()).toEqual({ pendingTransactionIds: [] });
  });

  it("[T-QE-006][QE-001] 현재 열린 같은 거래의 재전달은 pending 중복을 만들지 않는다", () => {
    const subject = createSubject();
    subject.open(validInput());

    expect(subject.open(validInput())).toEqual({
      kind: "Opened",
      transactionId: "transaction-1",
    });
    expect(subject.snapshot()).toEqual({
      activeTransactionId: "transaction-1",
      pendingTransactionIds: [],
    });
  });

  it("[T-QE-006][QE-001] 이미 대기 중인 같은 거래의 재전달은 queue entry 하나로 수렴한다", () => {
    const subject = createSubject();
    subject.open(validInput());
    const second = validInput({
      transactionResult: { kind: "created", transactionId: "transaction-2" },
    });
    subject.open(second);

    expect(subject.open(second)).toEqual({
      kind: "Queued",
      transactionId: "transaction-2",
    });
    expect(subject.snapshot().pendingTransactionIds).toEqual(["transaction-2"]);
  });
});
