import { describe, expect, it } from "vitest";

import { stableHouseholdId } from "../../../src/adapters/firebase/access/firebaseAccessPersistence";
import {
  validateCreateSelfInput,
} from "../../../src/contexts/access/google-onboarding/domain/policies/googleOnboardingPolicy";

describe("신규 가계부 생성 표기 계약", () => {
  it.each([
    ["  장휘민지  ", "장휘민지네 가계부"],
    ["장휘민지네", "장휘민지네 가계부"],
    ["장휘민지네 가계부", "장휘민지네 가계부"],
    ["우리 가계부", "우리 가계부"],
  ])("입력 이름 %s를 %s로 저장한다", (householdName, expectedName) => {
    expect(
      validateCreateSelfInput({ householdName, selfDisplayName: "민지" }),
    ).toEqual({
      kind: "valid",
      householdName: expectedName,
      selfDisplayName: "민지",
    });
  });

  it("빈 이름은 접미사를 붙이지 않고 거부한다", () => {
    expect(
      validateCreateSelfInput({ householdName: "   ", selfDisplayName: "민지" }),
    ).toEqual({
      kind: "invalid",
      code: "HOUSEHOLD_NAME_REQUIRED",
    });
  });

  it("householdId는 접두사 없는 32자리 소문자 16진수로 만든다", () => {
    const householdId = stableHouseholdId("principal-1", "command-1");

    expect(householdId).toMatch(/^[0-9a-f]{32}$/u);
    expect(householdId).not.toMatch(/^household-/u);
    expect(stableHouseholdId("principal-1", "command-1")).toBe(householdId);
  });

  it("서로 다른 생성 요청은 서로 다른 householdId를 만든다", () => {
    expect(stableHouseholdId("principal-1", "command-1")).not.toBe(
      stableHouseholdId("principal-1", "command-2"),
    );
  });
});
