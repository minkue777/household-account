import { describe, expect, it } from "vitest";
import {
  createCancellationQueryPreparationDriver,
  type CancellationPreparationObservation,
  type CancellationQueryPreparationDriver,
} from "../../../support/cancellation-query-preparation-driver";

export interface CancellationQueryPreparationContractSubject
  extends CancellationQueryPreparationDriver {}

export function createSubject(): CancellationQueryPreparationContractSubject {
  return createCancellationQueryPreparationDriver();
}

function observation(
  overrides: Partial<CancellationPreparationObservation> = {},
): CancellationPreparationObservation {
  return {
    amountInWon: 10_000,
    merchant: "  Original   Shop ",
    card: { companyLabel: " 국민 ", lastFour: "****-1234" },
    cancellationDate: "2026-07-20",
    observedDate: "2026-07-20",
    ...overrides,
  };
}

describe("취소 가구 범위·가맹점 mapping 후보 조회 준비 공개 계약", () => {
  it("[T-CAN-004][CAN-001] 가구 Actor가 없으면 후보 조회와 Ledger 변경을 모두 시작하지 않는다", () => {
    const subject = createSubject();

    expect(subject.prepare({ observation: observation() })).toEqual({
      kind: "Rejected",
      code: "HOUSEHOLD_REQUIRED",
    });
    expect(subject.state()).toEqual({ candidateQueries: [], ledgerWrites: [] });
  });

  it("[T-CAN-004][CAN-001/CAN-002] 가맹점 mapping과 카드 증거를 정규화해 같은 가구의 안전한 날짜 범위를 준비한다", () => {
    const subject = createSubject();

    const result = subject.prepare({
      actor: { householdId: "household-1", actingMemberId: "member-1" },
      observation: observation(),
      merchantMapping: { replacementMerchant: "  Mapped   Shop " },
    });

    expect(result).toEqual({
      kind: "Prepared",
      query: {
        queryId: expect.any(String),
        householdId: "household-1",
        observation: {
          cancellationDate: "2026-07-20",
          observedDate: "2026-07-20",
          amountInWon: 10_000,
          merchant: "mapped shop",
          card: { companyLabel: "국민", lastFour: "1234" },
        },
        searchWindow: {
          startDateInclusive: "2026-06-20",
          endDateInclusive: "2026-07-20",
        },
      },
    });
    if (result.kind !== "Prepared") {
      throw new Error("취소 후보 조회가 준비되어야 합니다.");
    }
    expect(subject.state()).toEqual({
      candidateQueries: [result.query],
      ledgerWrites: [],
    });
  });

  it("[T-CAN-004][CAN-001] mapping이 없으면 원 가맹점만 정규화하고 일치·삭제 정책은 실행하지 않는다", () => {
    const subject = createSubject();

    const result = subject.prepare({
      actor: { householdId: "household-1", actingMemberId: "member-1" },
      observation: observation(),
    });

    expect(result).toMatchObject({
      kind: "Prepared",
      query: {
        householdId: "household-1",
        observation: { merchant: "original shop" },
      },
    });
    expect(subject.state().candidateQueries).toHaveLength(1);
    expect(subject.state().ledgerWrites).toEqual([]);
  });

  it("[T-CAN-003][CAN-002] 취소 날짜를 해석하지 못하면 관찰 당일 범위만 준비한다", () => {
    const subject = createSubject();

    const result = subject.prepare({
      actor: { householdId: "household-1", actingMemberId: "member-1" },
      observation: observation({
        cancellationDate: "2026-02-30",
        observedDate: "2026-03-01",
      }),
    });

    expect(result).toMatchObject({
      kind: "Prepared",
      query: {
        observation: {
          cancellationDate: null,
          observedDate: "2026-03-01",
        },
        searchWindow: {
          startDateInclusive: "2026-03-01",
          endDateInclusive: "2026-03-01",
        },
      },
    });
    expect(subject.state().ledgerWrites).toEqual([]);
  });

  it("[T-CAN-003][CAN-002] 안전한 당일 fallback 기준일도 유효하지 않으면 조회를 만들지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.prepare({
        actor: { householdId: "household-1", actingMemberId: "member-1" },
        observation: observation({ observedDate: "2026-02-30" }),
      }),
    ).toEqual({ kind: "Rejected", code: "OBSERVED_DATE_INVALID" });
    expect(subject.state()).toEqual({ candidateQueries: [], ledgerWrites: [] });
  });
});
