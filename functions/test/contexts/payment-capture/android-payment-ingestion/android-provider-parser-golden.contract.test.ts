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
  const kbTransit = {
    source: { packageName: "com.kbcard.cxh.appcard", parserId: "kb-card-parser" },
    notification: {
      postedAt: "2026-10-02T05:20:39Z", title: "KB Pay",
      text: "KB국민카드\n후불교통(신용)\n22건 30,550원\n10/14 결제예정 ",
    },
    clockNow: "2030-01-01T00:00:00Z",
  };

  it.each(["com.kbcard.cxh.appcard", "com.kbcard.kbkookmincard"])(
    "[T-PARSE-001][PARSE-KB-001] %s의 후불교통 합계는 수신일에 한 건으로 해석하고 건수·카드 종류를 보존한다",
    (packageName) => {
      expect(createSubject().parse({ ...kbTransit, source: { ...kbTransit.source, packageName } })).toEqual({
        kind: "Parsed", payment: {
          type: "approval", amountInWon: 30_550,
          occurredLocalDate: "2026-10-02", occurredLocalTime: "14:20",
          merchant: "후불교통(신용) 22건", cardCompany: "국민", timeSource: "postedAt",
        },
      });
    },
  );

  it("[T-PARSE-001][T-PARSE-TIME-001][PARSE-KB-001] 후불교통 체크·CRLF·게시시각 누락은 주입 Clock으로 처리한다", () => {
    expect(createSubject().parse({ ...kbTransit,
      notification: { ...kbTransit.notification, postedAt: undefined, text: undefined,
        textLines: ["KB국민카드", "후불교통(체크)\r\n1건 1,550원", "01/14 결제예정"] },
      clockNow: "2027-01-02T00:01:00+09:00",
    })).toEqual({ kind: "Parsed", payment: {
      type: "approval", amountInWon: 1_550,
      occurredLocalDate: "2027-01-02", occurredLocalTime: "00:01",
      merchant: "후불교통(체크) 1건", cardCompany: "국민", timeSource: "clock",
    } });
  });

  it.each([
    ["22건", "0건"], ["22건", "-22건"], ["22건", "9007199254740992건"],
    ["30,550", "0"], ["30,550", "-30,550"], ["30,550", "2,147,483,648"],
    ["30,550", "30,55"], ["10/14", "13/14"], ["10/14", "02/30"],
    ["결제예정", "결제예정 안내 신청"], ["후불교통(신용)", "카드대금"],
    ["KB국민카드", "다른카드"], ["22건 30,550원", "최대 30,550원 캐시백"],
  ])("[T-PARSE-001][PARSE-KB-001] 후불교통이 아닌 안내·잘못된 합계 %s → %s는 지출을 만들지 않는다", (from, to) => {
    expect(createSubject().parse({ ...kbTransit,
      notification: { ...kbTransit.notification, text: kbTransit.notification.text.replace(from, to) },
    }).kind).toBe("Ignored");
  });

  const kbSalesCancellation = {
    source: { packageName: "com.kbcard.cxh.appcard", parserId: "kb-card-parser" },
    notification: {
      postedAt: "2026-10-07T00:04:12Z",
      title: "카드매출취소안내",
      text: "[KB국민카드] 1234 김*원님 예약서비스(구)- 09/28 이용건 10/06 전체취소(-120,000원)",
    },
    clockNow: "2030-01-01T00:00:00Z",
  };

  it.each(["com.kbcard.cxh.appcard", "com.kbcard.kbkookmincard"])(
    "[T-PARSE-002][PARSE-KB-001] %s 매출취소는 이용일 대신 취소일과 게시 시각을 쓰고 가맹점 원문을 보존한다",
    (packageName) => {
      expect(createSubject().parse({
        ...kbSalesCancellation,
        source: { ...kbSalesCancellation.source, packageName },
      })).toEqual({ kind: "Parsed", payment: {
        type: "cancellation", amountInWon: 120_000,
        occurredLocalDate: "2026-10-06", occurredLocalTime: "09:04",
        merchant: "예약서비스(구)-", cardCompany: "국민", maskedCardToken: "1234",
        timeSource: "postedAt",
      } });
    },
  );

  it("[T-PARSE-002][T-PARSE-TIME-001][PARSE-KB-001] 매출취소의 연말 날짜와 누락된 게시 시각은 주입 Clock으로 해석한다", () => {
    expect(createSubject().parse({
      ...kbSalesCancellation,
      notification: { ...kbSalesCancellation.notification, postedAt: undefined,
        text: kbSalesCancellation.notification.text.replace("09/28 이용건 10/06", "12/28 이용건 12/31") },
      clockNow: "2027-01-01T00:05:00+09:00",
    })).toMatchObject({ kind: "Parsed", payment: {
      occurredLocalDate: "2026-12-31", occurredLocalTime: "00:05", timeSource: "clock",
    } });
  });

  it.each([
    ["전체취소", "부분취소"], ["전체취소", "취소예정"],
    ["-120,000", "120,000"], ["-120,000", "--120,000"],
    ["-120,000", "-0"], ["-120,000", "-2,147,483,648"],
    ["-120,000", "-120,00"], ["09/28 이용건", "02/30 이용건"],
    ["10/06 전체취소", "13/06 전체취소"], ["예약서비스(구)-", ""],
    ["1234 김*원님", "김*원님"],
  ])("[T-PARSE-002][PARSE-KB-001] 매출취소의 잘못된 증거 %s → %s는 거래를 만들지 않는다", (from, to) => {
    expect(createSubject().parse({
      ...kbSalesCancellation,
      notification: { ...kbSalesCancellation.notification,
        text: kbSalesCancellation.notification.text.replace(from, to) },
    }).kind).toBe("Ignored");
  });

  it("[T-PARSE-001][T-PARSE-002] fixture는 모든 지원 공급자·승인·취소를 포함하고 case ID가 고유하다", () => {
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
          title: "KB국민카드1234 승인",
          text: "12,300원 일시불\n12/31 23:59\n가맹점가",
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



});
