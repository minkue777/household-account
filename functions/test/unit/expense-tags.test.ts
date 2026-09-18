import { describe, expect, it } from "vitest";

import { readExpenseTags, validateExpenseTags } from "../../src/contexts/household-finance/ledger/domain/policies/expenseTags";
import { createBasicLedgerCommandsFixtureSubject } from "../support/basic-ledger-commands-fixture";

describe("[T-LED-011][LED-011] 지출 태그 입력 정책", () => {
  it("기존 요청의 태그 생략을 허용하고 공백·해시 접두사·중복을 정리한다", () => {
    expect(validateExpenseTags(undefined)).toEqual({ kind: "valid", tags: [] });
    expect(validateExpenseTags([" #2026부산여행 ", "2026부산여행", "## 가족 여행", " ", "#"]))
      .toEqual({ kind: "valid", tags: ["2026부산여행", "가족 여행"] });
    expect(validateExpenseTags(["😀".repeat(30)])).toEqual({ kind: "valid", tags: ["😀".repeat(30)] });
  });

  it.each([
    [null, "TAGS_INVALID"],
    ["2026부산여행", "TAGS_INVALID"],
    [["2026부산여행", 1], "TAGS_INVALID"],
    [["가".repeat(31)], "TAG_TOO_LONG"],
    [Array.from({ length: 11 }, (_, index) => `행사${index}`), "TOO_MANY_TAGS"],
  ])("잘못된 태그 입력은 %j를 거부한다", (tags, code) => {
    expect(validateExpenseTags(tags)).toEqual({ kind: "validation-error", code });
  });

  it("이미 저장된 태그는 현재 입력 한도 때문에 사라지지 않는다", () => {
    const tags = [...Array.from({ length: 11 }, (_, index) => `행사${index}`), "가".repeat(31)];
    expect(readExpenseTags(tags)).toEqual(tags);
    expect(readExpenseTags(["2026부산여행", null, 1, "가족"])).toEqual(["2026부산여행", "가족"]);
  });

  it("태그를 생략한 기존 수정은 보존하고 명시한 빈 배열만 삭제한다", async () => {
    const subject = createBasicLedgerCommandsFixtureSubject({ now: "2026-09-18T09:00:00+09:00" });
    const actor = { householdId: "household-1", actingMemberId: "member-1" };
    const recorded = await subject.recordManualExpense({
      commandId: "tagged-expense", actor, merchant: "부산 식당", amountInWon: 20_000,
      categoryId: "food", accountingDate: "2026-09-18", tags: ["#2026부산여행"],
    });
    if (recorded.kind !== "success") throw new Error("지출 등록에 실패했습니다.");
    const transactionId = recorded.value.transactionId;
    expect(await subject.update({
      commandId: "legacy-edit", actor, transactionId, expectedVersion: 1, patch: { memo: "점심" },
    })).toMatchObject({ kind: "success", value: { tags: ["2026부산여행"], aggregateVersion: 2 } });
    expect(await subject.update({
      commandId: "remove-tags", actor, transactionId, expectedVersion: 2, patch: { tags: [] },
    })).toMatchObject({ kind: "success", value: { tags: [], aggregateVersion: 3 } });
    expect(subject.state().transactions[0].tags).toEqual([]);
  });
});
