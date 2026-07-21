import { describe, expect, it } from "vitest";

import { createQuickEditIntentMapperFixture } from "../../../support/quick-edit-intent-mapper-fixture";

export interface QuickEditIntentExtras {
  transactionId?: string;
  merchant?: string;
  amountInWon?: number;
  categoryId?: string;
  memo?: string;
}

export type QuickEditIntentMappingResult =
  | {
      kind: "Mapped";
      transactionId: string;
      form: {
        merchant: string;
        amountInWon: number;
        categoryId: string;
        memo: string;
      };
      commandsEnabled: true;
      dismissOnOutsideTouch: false;
    }
  | {
      kind: "MissingTransaction";
      form: {
        merchant: string;
        amountInWon: 0;
        categoryId: "etc";
        memo: string;
      };
      commandsEnabled: false;
      dismissOnOutsideTouch: false;
    };

export interface QuickEditIntentMapperContractSubject {
  map(extras: QuickEditIntentExtras): QuickEditIntentMappingResult;
}

export function createSubject(): QuickEditIntentMapperContractSubject {
  return createQuickEditIntentMapperFixture();
}

describe("QuickEdit Intent 표시값 매핑 공개 계약", () => {
  it("[T-QE-005][QE-008] 누락 표시 필드는 빈 문자열·0·etc로 정규화하고 외부 터치 종료를 막는다", () => {
    expect(
      createSubject().map({ transactionId: "transaction-1" }),
    ).toEqual({
      kind: "Mapped",
      transactionId: "transaction-1",
      form: {
        merchant: "",
        amountInWon: 0,
        categoryId: "etc",
        memo: "",
      },
      commandsEnabled: true,
      dismissOnOutsideTouch: false,
    });
  });

  it("[T-QE-005][QE-008] 전달된 표시값은 손실 없이 form snapshot으로 만든다", () => {
    expect(
      createSubject().map({
        transactionId: "transaction-1",
        merchant: "가맹점",
        amountInWon: 12_300,
        categoryId: "category-food",
        memo: "메모",
      }),
    ).toMatchObject({
      kind: "Mapped",
      transactionId: "transaction-1",
      form: {
        merchant: "가맹점",
        amountInWon: 12_300,
        categoryId: "category-food",
        memo: "메모",
      },
    });
  });

  it("[T-QE-005][QE-008] 거래 ID가 없으면 기본 표시값은 만들되 저장·삭제·분할 Command를 비활성화한다", () => {
    expect(createSubject().map({ merchant: "표시 전용" })).toEqual({
      kind: "MissingTransaction",
      form: {
        merchant: "표시 전용",
        amountInWon: 0,
        categoryId: "etc",
        memo: "",
      },
      commandsEnabled: false,
      dismissOnOutsideTouch: false,
    });
  });

  it("[T-QE-005][QE-008] 공백 거래 ID도 표시 전용 상태로 제한한다", () => {
    expect(createSubject().map({ transactionId: "   ", merchant: "표시 전용" })).toEqual({
      kind: "MissingTransaction",
      form: {
        merchant: "표시 전용",
        amountInWon: 0,
        categoryId: "etc",
        memo: "",
      },
      commandsEnabled: false,
      dismissOnOutsideTouch: false,
    });
  });
});
