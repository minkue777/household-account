import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";

interface AndroidGoldenFixture {
  fixtureVersion: number;
  zoneId: string;
  cases: readonly {
    caseId: string;
    requirementIds: readonly string[];
    source: { packageName: string; parserId: string };
    raw: {
      postedAt?: string;
      title?: string;
      text?: string;
      bigText?: string;
      textLines?: readonly string[];
    };
    expected: { kind: string; payment?: unknown; balance?: unknown; code?: string };
  }[];
}

interface ShortcutGoldenFixture {
  fixtureVersion: number;
  zoneId: string;
  cases: readonly {
    caseId: string;
    requirementIds: readonly string[];
    receivedAt: string;
    message: string;
    expected: {
      kind: string;
      cardEvidence?: { companyLabel: string };
      code?: string;
    };
  }[];
}

const android = readContractJson<AndroidGoldenFixture>(
  "fixtures/payment-capture/android-provider-parser-golden.v1.json",
);
const shortcut = readContractJson<ShortcutGoldenFixture>(
  "fixtures/payment-capture/shortcut-parser-golden.v1.json",
);

describe("Payment Capture 비식별 raw parser golden fixture", () => {
  it("[T-PARSE-001][T-PARSE-002] Android fixture는 모든 공급자 ID와 승인·취소·잔액·거부 사례를 중복 없이 가진다", () => {
    const requiredProviderIds = [
      "PARSE-KB-001",
      "PARSE-NH-001",
      "PARSE-NAVER-001",
      "PARSE-TOSS-001",
      "PARSE-KAKAO-001",
      "PARSE-ONNURI-001",
      "PARSE-PAYBOOC-001",
      "PARSE-SAMSUNG-001",
      "PARSE-LOTTE-001",
      "PARSE-GYEONGGI-001",
      "PARSE-DAEJEON-001",
      "PARSE-SEJONG-001",
      "PARSE-SMSBILL-001",
    ];
    const ids = android.cases.flatMap(({ requirementIds }) => requirementIds);
    const kinds = android.cases.map(({ expected }) => expected.kind);

    expect(android.fixtureVersion).toBe(1);
    expect(android.zoneId).toBe("Asia/Seoul");
    expect(new Set(android.cases.map(({ caseId }) => caseId)).size).toBe(
      android.cases.length,
    );
    expect(requiredProviderIds.every((id) => ids.includes(id))).toBe(true);
    expect(kinds).toContain("Parsed");
    expect(kinds).toContain("Ignored");
    expect(android.cases.some(({ expected }) => expected.balance !== undefined)).toBe(
      true,
    );
  });

  it("[T-PARSE-001][ING-006] Android fixture의 각 case는 합성 성공 ID가 아니라 package와 raw 알림 필드를 가진다", () => {
    for (const testCase of android.cases) {
      const rawTexts = [
        testCase.raw.title,
        testCase.raw.text,
        testCase.raw.bigText,
        ...(testCase.raw.textLines ?? []),
      ].filter((value): value is string => typeof value === "string");

      expect(testCase.source.packageName.length).toBeGreaterThan(0);
      expect(testCase.source.parserId.length).toBeGreaterThan(0);
      expect(rawTexts.some((value) => value.trim().length > 0)).toBe(true);
      expect(rawTexts.join("\n")).not.toContain("fixture:");
    }
  });

  it("[T-PARSE-004] Shortcut fixture는 지원 헤더 전체와 필수 typed 오류 경계를 가진다", () => {
    const parsedLabels = shortcut.cases.flatMap(({ expected }) =>
      expected.kind === "Parsed" && expected.cardEvidence
        ? [expected.cardEvidence.companyLabel]
        : [],
    );
    const rejectionCodes = shortcut.cases.flatMap(({ expected }) =>
      expected.kind === "Rejected" && expected.code ? [expected.code] : [],
    );

    expect(shortcut.fixtureVersion).toBe(1);
    expect(shortcut.zoneId).toBe("Asia/Seoul");
    expect(new Set(shortcut.cases.map(({ caseId }) => caseId)).size).toBe(
      shortcut.cases.length,
    );
    expect(new Set(parsedLabels)).toEqual(
      new Set(["삼성", "신한", "국민", "현대", "롯데", "하나", "우리", "비씨", "농협"]),
    );
    expect(rejectionCodes).toEqual(
      expect.arrayContaining([
        "CARD_COMPANY_REQUIRED",
        "UNSUPPORTED_CARD_COMPANY",
        "AMOUNT_NOT_POSITIVE",
        "AMOUNT_NOT_FINITE",
        "AMOUNT_OUT_OF_RANGE",
        "INVALID_DATE",
        "INVALID_TIME",
      ]),
    );
  });

  it("[T-PARSE-004][IOS-010] Shortcut raw fixture에는 Actor·가구·credential 값이 포함되지 않는다", () => {
    const serialized = JSON.stringify(shortcut.cases).toLowerCase();

    expect(serialized).not.toContain("householdid");
    expect(serialized).not.toContain("creatormemberid");
    expect(serialized).not.toContain("credential");
    expect(shortcut.cases.every(({ message }) => message.trim().length > 0)).toBe(
      true,
    );
  });
});
