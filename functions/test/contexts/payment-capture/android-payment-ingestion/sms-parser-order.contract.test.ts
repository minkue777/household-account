import { describe, expect, it } from "vitest";
import {
  createSmsParserOrderDriver,
  type SmsParserId,
  type SmsParserOrderInputPort,
  type SmsParserOrderState,
} from "../../../support/sms-parser-order-driver";

export interface SmsParserOrderContractSubject extends SmsParserOrderInputPort {
  state(): SmsParserOrderState;
}

export function createSubject(): SmsParserOrderContractSubject {
  return createSmsParserOrderDriver();
}

const parserPriority = [
  "KB",
  "NH",
  "NaverPay",
  "Toss",
  "KakaoPay",
  "DigitalOnnuri",
  "Paybooc",
  "Samsung",
  "Lotte",
  "Gyeonggi",
  "Daejeon",
  "SmsCardBill",
] as const satisfies readonly SmsParserId[];

describe("SMS parser 순서 공개 계약", () => {
  it("[T-SMS-ORDER-001][ING-007] 여러 parser가 성공해도 명시된 공급자 순서의 첫 결과만 선택한다", () => {
    const subject = createSubject();

    const result = subject.select({
      candidateId: "candidate-1",
      successfulParserIds: ["Daejeon", "Samsung", "Toss", "KB"],
    });

    expect(result).toEqual({
      kind: "Selected",
      parserId: "KB",
      candidateId: "candidate-1",
    });
    expect(subject.state()).toEqual({
      selectedParserId: "KB",
      unsupportedInternalParserIds: [],
    });
  });

  it("[T-SMS-ORDER-001][ING-007] 문자 청구 parser는 다른 모든 지원 parser가 실패한 뒤에만 선택한다", () => {
    const subject = createSubject();

    expect(
      subject.select({
        candidateId: "candidate-2",
        successfulParserIds: ["SmsCardBill", "Lotte"],
      }),
    ).toEqual({
      kind: "Selected",
      parserId: "Lotte",
      candidateId: "candidate-2",
    });
    expect(subject.state().selectedParserId).toBe("Lotte");
  });

  it("[T-SMS-ORDER-001][ING-007] 세종 parser는 SMS 내부 후보가 아니므로 성공 신호가 있어도 선택하지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.select({
        candidateId: "candidate-3",
        successfulParserIds: ["Sejong"],
      }),
    ).toEqual({ kind: "Unmatched" });
    expect(subject.state()).toEqual({
      selectedParserId: undefined,
      unsupportedInternalParserIds: ["Sejong"],
    });
  });

  it("[T-SMS-ORDER-001][ING-007] 각 우선순위 suffix에서 가장 앞선 parser를 결정적으로 선택한다", () => {
    const subject = createSubject();

    parserPriority.forEach((expectedParserId, index) => {
      const candidateId = `priority-candidate-${index}`;
      const successfulParserIds = [
        ...parserPriority.slice(index).reverse(),
        "Sejong",
      ] as const;

      expect(
        subject.select({ candidateId, successfulParserIds }),
      ).toEqual({
        kind: "Selected",
        parserId: expectedParserId,
        candidateId,
      });
      expect(subject.state()).toEqual({
        selectedParserId: expectedParserId,
        unsupportedInternalParserIds: ["Sejong"],
      });
    });
  });

  it("[T-SMS-ORDER-001][ING-007] 성공한 지원 parser가 하나도 없으면 선택 결과를 만들지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.select({
        candidateId: "candidate-unmatched",
        successfulParserIds: [],
      }),
    ).toEqual({ kind: "Unmatched" });
    expect(subject.state()).toEqual({
      selectedParserId: undefined,
      unsupportedInternalParserIds: [],
    });
  });
});
