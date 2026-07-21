import { describe, expect, it } from "vitest";

import { readContractJson } from "../../../support/contract-json";
import { createProviderParserGoldenDriver } from "../../../support/provider-parser-golden-driver";

type ProviderRequirementId =
  | "PARSE-KB-001"
  | "PARSE-NH-001"
  | "PARSE-NAVER-001"
  | "PARSE-TOSS-001"
  | "PARSE-KAKAO-001"
  | "PARSE-ONNURI-001"
  | "PARSE-PAYBOOC-001"
  | "PARSE-SAMSUNG-001"
  | "PARSE-LOTTE-001"
  | "PARSE-GYEONGGI-001"
  | "PARSE-DAEJEON-001"
  | "PARSE-SEJONG-001"
  | "PARSE-SMSBILL-001";

interface AndroidRawNotification {
  postedAt?: string;
  title?: string;
  text?: string;
  bigText?: string;
  textLines?: readonly string[];
}

interface AndroidProviderSource {
  packageName: string;
  parserId: string;
}

interface ParsedPaymentGolden {
  type: "approval" | "cancellation";
  amountInWon: number;
  occurredLocalDate: string;
  occurredLocalTime: string;
  merchant: string;
  cardCompany: string;
  maskedCardToken?: string;
  installmentMonths?: number;
  localCurrencyType?: string;
  timeSource?: "postedAt" | "clock";
}

type AndroidProviderParseResult =
  | {
      kind: "Parsed";
      payment?: ParsedPaymentGolden;
      balance?: { amountInWon: number; localCurrencyType: string };
    }
  | {
      kind: "Ignored" | "Rejected";
      code: string;
    };

interface AndroidProviderGoldenCase {
  caseId: string;
  requirementIds: readonly string[];
  source: AndroidProviderSource;
  raw: AndroidRawNotification;
  expected: AndroidProviderParseResult;
}

interface AndroidProviderGoldenFixtureV1 {
  fixtureVersion: 1;
  zoneId: "Asia/Seoul";
  cases: readonly AndroidProviderGoldenCase[];
}

export interface AndroidProviderParserGoldenSubject {
  parse(input: {
    source: AndroidProviderSource;
    notification: AndroidRawNotification;
    clockNow: string;
  }): AndroidProviderParseResult;
}

export function createSubject(): AndroidProviderParserGoldenSubject {
  return createProviderParserGoldenDriver();
}

const fixture = readContractJson<AndroidProviderGoldenFixtureV1>(
  "fixtures/payment-capture/android-provider-parser-golden.v1.json",
);

const providerRequirementIds: readonly ProviderRequirementId[] = [
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

function caseById(caseId: string): AndroidProviderGoldenCase {
  const found = fixture.cases.find((testCase) => testCase.caseId === caseId);
  if (!found) throw new Error(`Android parser golden case 없음: ${caseId}`);
  return found;
}

describe("Android 공급자별 비식별 raw parser 공개 계약", () => {
  it("[T-PARSE-001][T-PARSE-002] 모든 지원 공급자는 실제 raw 승인·지원 취소 결과를 golden snapshot으로 가진다", () => {
    const coveredIds = new Set(fixture.cases.flatMap(({ requirementIds }) => requirementIds));

    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.zoneId).toBe("Asia/Seoul");
    expect(new Set(fixture.cases.map(({ caseId }) => caseId)).size).toBe(
      fixture.cases.length,
    );
    expect(providerRequirementIds.every((id) => coveredIds.has(id))).toBe(true);
    expect(
      fixture.cases.some(({ expected }) =>
        expected.kind === "Parsed" && expected.payment?.type === "cancellation",
      ),
    ).toBe(true);
  });

  it.each(fixture.cases)(
    "[T-PARSE-001][T-PARSE-002] $caseId raw 입력은 공개 ParseResult 전체와 일치한다",
    ({ source, raw, expected }) => {
      const result = createSubject().parse({
        source,
        notification: raw,
        clockNow: "2026-07-21T01:02:00+09:00",
      });

      expect(result).toEqual(expected);
    },
  );

  it("[T-PARSE-001][PARSE-TOSS-001] 토스는 가승인을 저장하지 않고 승인 cashback만 차감하며 취소는 총액을 보존한다", () => {
    expect(caseById("toss-preauthorization-ignored").expected).toEqual({
      kind: "Ignored",
      code: "PREAUTHORIZATION",
    });
    expect(caseById("toss-check-card-cashback").expected).toMatchObject({
      payment: { type: "approval", amountInWon: 2_500 },
    });
    expect(caseById("toss-cashback-clamped-to-zero").expected).toMatchObject({
      payment: { type: "approval", amountInWon: 0 },
    });
    expect(caseById("toss-cancellation-total").expected).toMatchObject({
      payment: { type: "cancellation", amountInWon: 3_000 },
    });
  });

  it.each([
    ["naver-approval-posted-time", "com.naverfin.payapp"],
    ["kakao-approval-posted-time", "com.kakaopay.app"],
    ["onnuri-approval-posted-time", "com.komsco.kpay"],
    ["daejeon-fallback-approval", "kr.co.nmcs.daejeonpay"],
    ["sms-bill-approved", "com.google.android.apps.messaging"],
  ] as const)(
    "[T-PARSE-TIME-001][PARSE-COMMON-001] %s는 postedAt이 없을 때만 주입 Clock을 사용한다",
    (caseId, packageName) => {
      const golden = caseById(caseId);
      const { postedAt: _postedAt, ...withoutPostedAt } = golden.raw;
      const result = createSubject().parse({
        source: { ...golden.source, packageName },
        notification: withoutPostedAt,
        clockNow: "2026-07-21T01:02:59+09:00",
      });

      expect(result).toMatchObject({
        kind: "Parsed",
        payment: {
          occurredLocalDate: "2026-07-21",
          occurredLocalTime: "01:02",
          timeSource: "clock",
        },
      });
    },
  );

  it("[T-PARSE-TIME-001][PARSE-COMMON-001] 유효하지 않은 postedAt은 사용하지 않고 주입 Clock의 서울 시각으로 fallback한다", () => {
    const golden = caseById("naver-approval-posted-time");

    expect(
      createSubject().parse({
        source: golden.source,
        notification: { ...golden.raw, postedAt: "not-an-instant" },
        clockNow: "2026-07-21T01:02:59+09:00",
      }),
    ).toMatchObject({
      kind: "Parsed",
      payment: {
        occurredLocalDate: "2026-07-21",
        occurredLocalTime: "01:02",
        timeSource: "clock",
      },
    });
  });

  it("[T-PARSE-TIME-001][PARSE-COMMON-001] offset이 다른 postedAt도 Asia/Seoul 거래 시각으로 변환한다", () => {
    const golden = caseById("naver-approval-posted-time");

    expect(
      createSubject().parse({
        source: golden.source,
        notification: { ...golden.raw, postedAt: "2026-07-20T16:30:45Z" },
        clockNow: "2027-01-01T00:00:00+09:00",
      }),
    ).toMatchObject({
      kind: "Parsed",
      payment: {
        occurredLocalDate: "2026-07-21",
        occurredLocalTime: "01:30",
        timeSource: "postedAt",
      },
    });
  });

  it("[T-PARSE-003][T-PARSE-TIME-001][PARSE-KB-001][PARSE-COMMON-001] 연초에 수신한 전년 말 승인은 미래가 아닌 가장 가까운 연도를 선택한다", () => {
    expect(
      createSubject().parse({
        source: {
          packageName: "com.kbcard.cxh.appcard",
          parserId: "kb-card-parser",
        },
        notification: {
          postedAt: "2026-01-01T00:05:00+09:00",
          title: "KB국민카드",
          text: "승인 12,300원\n12/31 23:59\n국민(1234)\n가맹점가",
        },
        clockNow: "2030-01-01T00:00:00+09:00",
      }),
    ).toMatchObject({
      kind: "Parsed",
      payment: {
        occurredLocalDate: "2025-12-31",
        occurredLocalTime: "23:59",
      },
    });
  });

  it("[T-ING-003][ING-002] parser와 결합되지 않은 package는 지원 본문이어도 다른 공급자로 간주해 무시한다", () => {
    const golden = caseById("kb-approval");

    expect(
      createSubject().parse({
        source: {
          packageName: "com.naverfin.payapp",
          parserId: "kb-card-parser",
        },
        notification: golden.raw,
        clockNow: "2026-07-21T01:02:00+09:00",
      }),
    ).toEqual({ kind: "Ignored", code: "UNSUPPORTED_SOURCE" });
  });

  it("[T-PARSE-001][T-ING-BAL-001] 지역화폐 parser가 검증한 유형과 거래·잔액은 서로 독립된 결과로 보존된다", () => {
    for (const caseId of [
      "gyeonggi-payment-and-balance",
      "daejeon-detail-payment-and-balance",
      "sejong-payment-and-balance",
    ]) {
      const expected = caseById(caseId).expected;
      if (expected.kind !== "Parsed") throw new Error("지역화폐 fixture 오류");

      expect(expected.payment?.localCurrencyType).toBe(
        expected.balance?.localCurrencyType,
      );
      expect(expected.payment).toBeDefined();
      expect(expected.balance).toBeDefined();
    }

    for (const caseId of ["gyeonggi-balance-only", "sejong-balance-only"]) {
      const expected = caseById(caseId).expected;
      if (expected.kind !== "Parsed") throw new Error("잔액 전용 fixture 오류");

      expect(expected.payment).toBeUndefined();
      expect(expected.balance).toBeDefined();
    }
  });

  it("[T-PARSE-001][PARSE-SMSBILL-001] 문자 청구 parser는 정상 납부 완료만 승인하고 납부 예정 문장은 무시한다", () => {
    expect(caseById("sms-bill-approved").expected).toMatchObject({
      kind: "Parsed",
      payment: { type: "approval", amountInWon: 182_000 },
    });
    expect(caseById("sms-bill-similar-message-ignored").expected).toEqual({
      kind: "Ignored",
      code: "NOT_COMPLETED_PAYMENT",
    });
  });
});
