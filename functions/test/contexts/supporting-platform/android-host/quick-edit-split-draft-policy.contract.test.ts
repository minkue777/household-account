import { describe, expect, it } from "vitest";

import { createQuickEditSplitDraftFixture } from "../../../support/quick-edit-split-draft-fixture";

export interface QuickEditSplitItem {
  itemId: string;
  amountInWon: number;
}

export interface QuickEditSplitDraftState {
  originalAmountInWon: number;
  items: readonly QuickEditSplitItem[];
  unallocatedAmountInWon: number;
}

export type SplitDraftMutationResult =
  | { kind: "Updated"; draft: QuickEditSplitDraftState }
  | { kind: "Rejected"; code: "MINIMUM_TWO_ITEMS" | "ITEM_NOT_FOUND" };

export type SplitDraftValidationResult =
  | { kind: "Valid" }
  | {
      kind: "Invalid";
      code: "MINIMUM_TWO_ITEMS" | "NON_POSITIVE_ITEM" | "TOTAL_MISMATCH";
    };

export interface QuickEditSplitDraftPolicySubject {
  initialize(originalAmountInWon: number): QuickEditSplitDraftState;
  changeAmount(itemId: string, amountInWon: number): SplitDraftMutationResult;
  addItem(): SplitDraftMutationResult;
  removeItem(itemId: string): SplitDraftMutationResult;
  validate(): SplitDraftValidationResult;
  state(): QuickEditSplitDraftState;
}

export function createSubject(): QuickEditSplitDraftPolicySubject {
  return createQuickEditSplitDraftFixture();
}

describe("QuickEdit 분할 초안 공개 계약", () => {
  it("[T-QE-001][QE-005/QE-007] 첫 두 항목은 원금의 몫과 나머지로 초기화한다", () => {
    const subject = createSubject();

    expect(subject.initialize(10_001)).toEqual({
      originalAmountInWon: 10_001,
      items: [
        { itemId: expect.any(String), amountInWon: 5_000 },
        { itemId: expect.any(String), amountInWon: 5_001 },
      ],
      unallocatedAmountInWon: 0,
    });
    expect(subject.validate()).toEqual({ kind: "Valid" });
  });

  it("[T-QE-001][QE-007] 두 항목 중 하나를 바꾸면 반대 항목을 max(0, 원금-입력값)으로 조정한다", () => {
    const subject = createSubject();
    const initial = subject.initialize(10_001);

    const changed = subject.changeAmount(initial.items[0].itemId, 7_000);

    expect(changed).toEqual({
      kind: "Updated",
      draft: {
        originalAmountInWon: 10_001,
        items: [
          { itemId: initial.items[0].itemId, amountInWon: 7_000 },
          { itemId: initial.items[1].itemId, amountInWon: 3_001 },
        ],
        unallocatedAmountInWon: 0,
      },
    });
    expect(subject.validate()).toEqual({ kind: "Valid" });

    subject.changeAmount(initial.items[0].itemId, 12_000);
    expect(subject.state().items[1].amountInWon).toBe(0);
    expect(subject.validate()).toEqual({
      kind: "Invalid",
      code: "NON_POSITIVE_ITEM",
    });
  });

  it("[T-QE-001][QE-007] 세 항목 이상에서는 한 금액을 바꿔도 다른 항목을 자동 조정하지 않는다", () => {
    const subject = createSubject();
    const initial = subject.initialize(10_000);
    const added = subject.addItem();
    expect(added).toMatchObject({
      kind: "Updated",
      draft: {
        items: [
          { amountInWon: 5_000 },
          { amountInWon: 5_000 },
          { amountInWon: 0 },
        ],
      },
    });
    const thirdId = subject.state().items[2].itemId;

    subject.changeAmount(thirdId, 2_000);

    expect(subject.state().items).toEqual([
      { itemId: initial.items[0].itemId, amountInWon: 5_000 },
      { itemId: initial.items[1].itemId, amountInWon: 5_000 },
      { itemId: thirdId, amountInWon: 2_000 },
    ]);
    expect(subject.validate()).toEqual({
      kind: "Invalid",
      code: "TOTAL_MISMATCH",
    });
  });

  it("[T-QE-001][QE-007] 새 항목은 현재 미배분 잔액으로 시작하고 두 항목 아래로 삭제하지 않는다", () => {
    const subject = createSubject();
    subject.initialize(10_000);
    subject.addItem();
    const thirdId = subject.state().items[2].itemId;

    expect(subject.state().items[2]).toEqual({
      itemId: thirdId,
      amountInWon: 0,
    });
    expect(subject.removeItem(thirdId).kind).toBe("Updated");
    const firstId = subject.state().items[0].itemId;
    expect(subject.removeItem(firstId)).toEqual({
      kind: "Rejected",
      code: "MINIMUM_TWO_ITEMS",
    });
    expect(subject.state().items).toHaveLength(2);
  });

  it("[T-QE-001][QE-007] 세 항목 이상에서 양수 미배분 잔액이 있으면 새 항목은 그 잔액으로 시작한다", () => {
    const subject = createSubject();
    const initial = subject.initialize(10_000);
    subject.addItem();
    const thirdId = subject.state().items[2].itemId;

    subject.changeAmount(thirdId, 1_000);
    subject.changeAmount(initial.items[0].itemId, 3_000);
    expect(subject.state()).toMatchObject({
      items: [
        { itemId: initial.items[0].itemId, amountInWon: 3_000 },
        { itemId: initial.items[1].itemId, amountInWon: 5_000 },
        { itemId: thirdId, amountInWon: 1_000 },
      ],
      unallocatedAmountInWon: 1_000,
    });

    const added = subject.addItem();
    expect(added).toMatchObject({
      kind: "Updated",
      draft: {
        items: [
          { amountInWon: 3_000 },
          { amountInWon: 5_000 },
          { amountInWon: 1_000 },
          { amountInWon: 1_000 },
        ],
        unallocatedAmountInWon: 0,
      },
    });
    expect(subject.validate()).toEqual({ kind: "Valid" });
  });

  it("[T-QE-001][QE-007] 존재하지 않는 항목의 변경·삭제는 초안을 바꾸지 않는다", () => {
    const subject = createSubject();
    const initial = subject.initialize(10_000);

    expect(subject.changeAmount("missing-item", 1_000)).toEqual({
      kind: "Rejected",
      code: "ITEM_NOT_FOUND",
    });
    expect(subject.removeItem("missing-item")).toEqual({
      kind: "Rejected",
      code: "ITEM_NOT_FOUND",
    });
    expect(subject.state()).toEqual(initial);
  });
});
