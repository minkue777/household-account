import { describe, expect, it } from "vitest";

import { readContractJson } from "../../../support/contract-json";
import { createShortcutCardMessageParserDriver } from "../../../support/shortcut-card-message-parser-driver";

type ShortcutParseResult =
  | {
      kind: "Parsed";
      amountInWon: number;
      occurredLocalDate: string;
      occurredLocalTime: string;
      merchant: string;
      cardEvidence: { companyLabel: string; maskedToken?: string };
    }
  | {
      kind: "Rejected";
      code:
        | "CARD_COMPANY_REQUIRED"
        | "UNSUPPORTED_CARD_COMPANY"
        | "AMOUNT_NOT_POSITIVE"
        | "AMOUNT_NOT_FINITE"
        | "AMOUNT_OUT_OF_RANGE"
        | "INVALID_DATE"
        | "INVALID_TIME"
        | "UNSUPPORTED_MESSAGE";
    };

interface ShortcutParserGoldenCase {
  caseId: string;
  requirementIds: readonly string[];
  receivedAt: string;
  message: string;
  expected: ShortcutParseResult;
}

interface ShortcutParserGoldenFixtureV1 {
  fixtureVersion: 1;
  zoneId: "Asia/Seoul";
  cases: readonly ShortcutParserGoldenCase[];
}

export interface ShortcutCardMessageParserGoldenSubject {
  parse(input: {
    message: string;
    receivedAt: string;
    zoneId: "Asia/Seoul";
  }): ShortcutParseResult;
}

export function createSubject(): ShortcutCardMessageParserGoldenSubject {
  return createShortcutCardMessageParserDriver();
}

const fixture = readContractJson<ShortcutParserGoldenFixtureV1>(
  "fixtures/payment-capture/shortcut-parser-golden.v1.json",
);

describe("Shortcut 카드 문자 비식별 raw parser 공개 계약", () => {
  it.each(fixture.cases)(
    "[T-PARSE-004][T-IOS-002] $caseId raw message는 전체 evidence 또는 typed 오류와 일치한다",
    ({ message, receivedAt, expected }) => {
      expect(
        createSubject().parse({
          message,
          receivedAt,
          zoneId: fixture.zoneId,
        }),
      ).toEqual(expected);
    },
  );

  it("[T-PARSE-004][IOS-003] 지원 카드사 표 전체를 인식하고 BC·NH만 표준 라벨로 정규화한다", () => {
    const expectedLabels = new Map([
      ["samsung", "삼성"],
      ["shinhan", "신한"],
      ["kb", "국민"],
      ["hyundai", "현대"],
      ["lotte", "롯데"],
      ["hana", "하나"],
      ["woori", "우리"],
      ["bc-normalized", "비씨"],
      ["nh-normalized", "농협"],
    ]);

    for (const [caseId, companyLabel] of expectedLabels) {
      const testCase = fixture.cases.find((item) => item.caseId === caseId);
      if (!testCase) throw new Error(`Shortcut parser case 없음: ${caseId}`);
      expect(testCase.expected).toMatchObject({
        kind: "Parsed",
        cardEvidence: { companyLabel },
      });
    }
  });

  it.each([
    {
      name: "카드사 헤더 없음",
      message: "1234승인 김*원\n10,000원 일시불\n07/19 08:50 가맹점가",
      code: "CARD_COMPANY_REQUIRED" as const,
    },
    {
      name: "미지원 카드사 헤더",
      message: "케이뱅크1234승인 김*원\n10,000원 일시불\n07/19 08:50 가맹점가",
      code: "UNSUPPORTED_CARD_COMPANY" as const,
    },
    {
      name: "NaN 금액",
      message: "국민1234승인 김*원\nNaN원 일시불\n07/19 08:50 가맹점가",
      code: "AMOUNT_NOT_FINITE" as const,
    },
    {
      name: "실재하지 않는 날짜",
      message: "국민1234승인 김*원\n10,000원 일시불\n02/30 08:50 가맹점가",
      code: "INVALID_DATE" as const,
    },
    {
      name: "24시",
      message: "국민1234승인 김*원\n10,000원 일시불\n07/19 24:00 가맹점가",
      code: "INVALID_TIME" as const,
    },
  ])(
    "[T-PARSE-004][T-IOS-002][IOS-003][IOS-010] $name은 추정·삼성 fallback 없이 $code로 거부한다",
    ({ message, code }) => {
      expect(
        createSubject().parse({
          message,
          receivedAt: "2026-07-19T09:00:00+09:00",
          zoneId: "Asia/Seoul",
        }),
      ).toEqual({ kind: "Rejected", code });
    },
  );

  it("[T-PARSE-003][T-PARSE-004][IOS-004] MM/DD가 수신 시각보다 미래이면 과거 중 가장 가까운 유효 연도를 선택한다", () => {
    const testCase = fixture.cases.find(
      ({ caseId }) => caseId === "nearest-past-year",
    );
    if (!testCase) throw new Error("nearest-past-year case 없음");

    expect(
      createSubject().parse({
        message: testCase.message,
        receivedAt: testCase.receivedAt,
        zoneId: fixture.zoneId,
      }),
    ).toMatchObject({
      kind: "Parsed",
      occurredLocalDate: "2025-12-31",
      occurredLocalTime: "23:59",
    });
  });

  it("[T-PARSE-004][IOS-003] 전각·반각 별표와 구분자가 섞인 카드 token은 숫자·x만 남긴 마지막 네 자리로 정규화한다", () => {
    expect(
      createSubject().parse({
        message: "국민＊＊-12*3승인 김*원\n10,000원 일시불\n07/19 08:50 가맹점가",
        receivedAt: "2026-07-19T08:51:00+09:00",
        zoneId: "Asia/Seoul",
      }),
    ).toMatchObject({
      kind: "Parsed",
      cardEvidence: { companyLabel: "국민", maskedToken: "12x3" },
    });
  });

  it("[T-PARSE-003][T-PARSE-004][IOS-004] 같은 날짜라도 결제 시각이 수신 시각보다 미래이면 전년으로 내린다", () => {
    expect(
      createSubject().parse({
        message: "국민3456승인 김*원\n10,000원 일시불\n07/19 08:50 가맹점가",
        receivedAt: "2026-07-19T08:49:00+09:00",
        zoneId: "Asia/Seoul",
      }),
    ).toMatchObject({
      kind: "Parsed",
      occurredLocalDate: "2025-07-19",
      occurredLocalTime: "08:50",
    });
  });

  it("[T-PARSE-003][T-PARSE-004][IOS-004] 비윤년의 02/29는 유효하면서 가장 가까운 과거 윤년을 선택한다", () => {
    expect(
      createSubject().parse({
        message: "국민3456승인 김*원\n10,000원 일시불\n02/29 08:50 가맹점가",
        receivedAt: "2025-03-01T08:51:00+09:00",
        zoneId: "Asia/Seoul",
      }),
    ).toMatchObject({
      kind: "Parsed",
      occurredLocalDate: "2024-02-29",
      occurredLocalTime: "08:50",
    });
  });

  it("[T-PARSE-004][T-IOS-002][IOS-010] JavaScript 안전 정수 최대 금액은 overflow로 오인하지 않는다", () => {
    expect(
      createSubject().parse({
        message: "국민3456승인 김*원\n9,007,199,254,740,991원 일시불\n07/19 08:50 가맹점가",
        receivedAt: "2026-07-19T08:51:00+09:00",
        zoneId: "Asia/Seoul",
      }),
    ).toMatchObject({
      kind: "Parsed",
      amountInWon: Number.MAX_SAFE_INTEGER,
    });
  });

  it("[T-PARSE-004][T-IOS-002][IOS-010] 지수 표기 금액은 숫자로 암묵 변환하지 않고 지원하지 않는 message로 거부한다", () => {
    expect(
      createSubject().parse({
        message: "국민3456승인 김*원\n1e3원 일시불\n07/19 08:50 가맹점가",
        receivedAt: "2026-07-19T08:51:00+09:00",
        zoneId: "Asia/Seoul",
      }),
    ).toEqual({ kind: "Rejected", code: "UNSUPPORTED_MESSAGE" });
  });

  it("[T-PARSE-004][T-IOS-002][IOS-003][IOS-010] 가맹점이 비어 있는 형식은 추정하지 않고 지원하지 않는 message로 거부한다", () => {
    expect(
      createSubject().parse({
        message: "국민3456승인 김*원\n10,000원 일시불\n07/19 08:50   ",
        receivedAt: "2026-07-19T08:51:00+09:00",
        zoneId: "Asia/Seoul",
      }),
    ).toEqual({ kind: "Rejected", code: "UNSUPPORTED_MESSAGE" });
  });
});
