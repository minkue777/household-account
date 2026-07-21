import { describe, expect, it } from "vitest";
import {
  createParsedObservationClassificationDriver,
  type ParsedBalanceEvidence,
  type ParsedObservationClassificationInputPort,
  type ParsedTransactionEvidence,
} from "../../../support/parsed-observation-classification-driver";

export interface ParsedObservationClassificationSubject
  extends ParsedObservationClassificationInputPort {}

export function createSubject(): ParsedObservationClassificationSubject {
  return createParsedObservationClassificationDriver();
}

function transaction(
  overrides: Partial<ParsedTransactionEvidence> = {},
): ParsedTransactionEvidence {
  return {
    observationType: "approval",
    amountInWon: 12_000,
    occurredLocalDate: "2026-07-19",
    occurredLocalTime: "10:05",
    merchant: "가맹점 A",
    card: { companyLabel: "국민", maskedToken: "1234" },
    ...overrides,
  };
}

function balance(): ParsedBalanceEvidence {
  return {
    currencyType: "gyeonggi",
    balanceInWon: 88_000,
    observedAt: "2026-07-19T10:05:00+09:00",
  };
}

describe("parser 결과의 Capture branch 분류 공개 계약", () => {
  it.each(["approval", "cancellation"] as const)(
    "[T-PARSE-001][T-PARSE-002][ING-003] %s 결과를 같은 종류의 payment branch로 보존한다",
    (observationType) => {
      const result = createSubject().classify({
        transactionCandidate: transaction({ observationType }),
      });

      expect(result).toMatchObject({
        kind: "accepted",
        envelope: {
          contractVersion: "capture-envelope.v1",
          originChannel: "android-notification",
          paymentObservation: {
            branchId: expect.any(String),
            observationType,
            amountInWon: 12_000,
            occurredLocalDate: "2026-07-19",
            occurredLocalTime: "10:05",
            zoneId: "Asia/Seoul",
            merchantEvidence: { rawCandidate: "가맹점 A" },
            cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
          },
        },
      });
      if (result.kind === "accepted") {
        expect(result.envelope.paymentObservation?.branchId).not.toBe("");
        expect(result.envelope.balanceObservation).toBeUndefined();
      }
    },
  );

  it("[T-ING-BAL-001][ING-009] balance-only 결과를 거래 실패로 축약하지 않고 balance branch로 수용한다", () => {
    const result = createSubject().classify({ balanceCandidate: balance() });

    expect(result).toMatchObject({
      kind: "accepted",
      envelope: {
        balanceObservation: {
          ...balance(),
          branchId: expect.any(String),
        },
      },
    });
    if (result.kind === "accepted") {
      expect(result.envelope.paymentObservation).toBeUndefined();
      expect(result.envelope.balanceObservation?.branchId).not.toBe("");
    }
  });

  it("[T-ING-BAL-001][ING-009] 한 parser 결과의 payment와 balance를 서로 독립된 두 branch로 모두 보존한다", () => {
    const result = createSubject().classify({
      transactionCandidate: transaction(),
      balanceCandidate: balance(),
    });

    expect(result).toMatchObject({
      kind: "accepted",
      envelope: {
        paymentObservation: {
          branchId: expect.any(String),
          observationType: "approval",
          amountInWon: 12_000,
        },
        balanceObservation: {
          ...balance(),
          branchId: expect.any(String),
        },
      },
    });
    if (result.kind === "accepted") {
      expect(result.envelope.paymentObservation?.branchId).not.toBe("");
      expect(result.envelope.balanceObservation?.branchId).not.toBe("");
      expect(result.envelope.paymentObservation?.branchId).not.toBe(
        result.envelope.balanceObservation?.branchId,
      );
    }
  });

  it("[ING-003] 거래·잔액 후보가 모두 없으면 Capture envelope를 만들지 않는다", () => {
    const result = createSubject().classify({});

    expect(result).toEqual({ kind: "ignored", code: "PARSE_FAILED" });
    expect(result).not.toHaveProperty("envelope");
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    9_007_199_254_740_992,
  ])(
    "[T-PARSE-001][ING-003] 유한한 양의 안전 정수가 아닌 금액 %s원을 거부한다",
    (amountInWon) => {
      const result = createSubject().classify({
        transactionCandidate: transaction({ amountInWon }),
      });

      expect(result).toEqual({ kind: "ignored", code: "INVALID_AMOUNT" });
      expect(result).not.toHaveProperty("envelope");
    },
  );

  it.each([
    {
      name: "실재하지 않는 날짜",
      override: { occurredLocalDate: "2026-02-30" },
      code: "INVALID_DATE",
    },
    {
      name: "0이 생략된 날짜",
      override: { occurredLocalDate: "2026-7-19" },
      code: "INVALID_DATE",
    },
    {
      name: "24시",
      override: { occurredLocalTime: "24:00" },
      code: "INVALID_TIME",
    },
    {
      name: "범위를 벗어난 분",
      override: { occurredLocalTime: "10:60" },
      code: "INVALID_TIME",
    },
    {
      name: "초가 포함된 시각",
      override: { occurredLocalTime: "10:05:00" },
      code: "INVALID_TIME",
    },
  ] as const)(
    "[T-PARSE-001][T-PARSE-002][ING-003] $name 입력은 $code로 거부한다",
    ({ override, code }) => {
      const result = createSubject().classify({
        transactionCandidate: transaction(override),
      });

      expect(result).toEqual({ kind: "ignored", code });
      expect(result).not.toHaveProperty("envelope");
    },
  );

  it("[T-PARSE-001][T-PARSE-002][ING-003] 비어 있는 가맹점 증거를 승인·취소 branch로 전달하지 않는다", () => {
    const result = createSubject().classify({
      transactionCandidate: transaction({ merchant: "   " }),
    });

    expect(result).toEqual({ kind: "ignored", code: "PARSE_FAILED" });
    expect(result).not.toHaveProperty("envelope");
  });

  it("[T-ING-BAL-001][ING-009] 잘못된 거래 후보가 있어도 유효한 balance branch는 보존한다", () => {
    const result = createSubject().classify({
      transactionCandidate: transaction({ amountInWon: 0 }),
      balanceCandidate: balance(),
    });

    expect(result).toMatchObject({
      kind: "accepted",
      envelope: {
        balanceObservation: {
          ...balance(),
          branchId: expect.any(String),
        },
      },
    });
    if (result.kind === "accepted") {
      expect(result.envelope.paymentObservation).toBeUndefined();
      expect(result.envelope.balanceObservation?.branchId).not.toBe("");
    }
  });

  it("[T-PARSE-001][ING-003] 카드 증거가 없는 정상 거래에는 빈 cardEvidence를 만들지 않는다", () => {
    const result = createSubject().classify({
      transactionCandidate: transaction({ card: undefined }),
    });

    expect(result).toMatchObject({
      kind: "accepted",
      envelope: {
        paymentObservation: {
          observationType: "approval",
          amountInWon: 12_000,
        },
      },
    });
    if (result.kind === "accepted") {
      expect(result.envelope.paymentObservation).not.toHaveProperty(
        "cardEvidence",
      );
    }
  });
});
