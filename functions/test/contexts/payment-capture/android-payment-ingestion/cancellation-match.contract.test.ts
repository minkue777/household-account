import { describe, expect, it } from "vitest";
import {
  createCancellationMatchDriver,
  type CancellationCandidateFact,
  type CancellationMatchInputPort,
  type CancellationObservation,
} from "../../../support/cancellation-match-driver";

export interface CancellationMatchContractSubject
  extends CancellationMatchInputPort {}

export function createSubject(): CancellationMatchContractSubject {
  return createCancellationMatchDriver();
}

function observation(
  overrides: Partial<CancellationObservation> = {},
): CancellationObservation {
  return {
    cancellationDate: "2026-03-31",
    observedDate: "2026-03-31",
    amountInWon: 10_000,
    merchant: "Coffee Shop",
    card: { companyLabel: "국민", lastFour: "1234" },
    ...overrides,
  };
}

function candidate(
  captureLineageId: string,
  overrides: Partial<CancellationCandidateFact> = {},
): CancellationCandidateFact {
  return {
    captureLineageId,
    approvalDate: "2026-03-30",
    amountInWon: 10_000,
    merchant: "Coffee Shop",
    card: { companyLabel: "국민", lastFour: "1234" },
    ...overrides,
  };
}

describe("결제 취소 일치 판정 공개 계약", () => {
  it("[T-CAN-002] 원거래 후보가 없으면 보류 상태 없이 무변경 NotFound로 끝낸다", () => {
    const result = createSubject().decide({
      observation: observation(),
      candidates: [],
    });

    expect(result).toEqual({
      kind: "notFound",
      resource: "cancellationTarget",
    });
  });

  it("[T-CAN-003] 금액·정규 가맹점·카드가 모두 일치하는 유일 lineage만 확정한다", () => {
    const result = createSubject().decide({
      observation: observation({ merchant: "  COFFEE   shop " }),
      candidates: [candidate("lineage-a", { merchant: "coffee shop" })],
    });

    expect(result).toEqual({
      kind: "matched",
      captureLineageId: "lineage-a",
    });
  });

  it.each([
    {
      name: "금액",
      changed: candidate("lineage-a", { amountInWon: 9_999 }),
    },
    {
      name: "가맹점",
      changed: candidate("lineage-a", { merchant: "Another Shop" }),
    },
    {
      name: "카드사",
      changed: candidate("lineage-a", {
        card: { companyLabel: "농협", lastFour: "1234" },
      }),
    },
    {
      name: "카드 끝 번호",
      changed: candidate("lineage-a", {
        card: { companyLabel: "국민", lastFour: "9999" },
      }),
    },
  ])(
    "[T-CAN-003] $name만 다른 후보도 취소하지 않는다",
    ({ changed }) => {
      const result = createSubject().decide({
        observation: observation(),
        candidates: [changed],
      });

      expect(result).toEqual({
        kind: "notFound",
        resource: "cancellationTarget",
      });
    },
  );

  it.each([
    { splitCount: 1, acceptedDifference: 0, rejectedDifference: 1 },
    { splitCount: 2, acceptedDifference: 1, rejectedDifference: 2 },
    { splitCount: 12, acceptedDifference: 11, rejectedDifference: 12 },
  ])(
    "[T-CAN-006][CAN-006] $splitCount개월 분할은 최대 $acceptedDifference원 내림 오차만 허용한다",
    ({ splitCount, acceptedDifference, rejectedDifference }) => {
      const subject = createSubject();
      const resultAtBoundary = subject.decide({
        observation: observation({ amountInWon: 120_000 }),
        candidates: [
          candidate("monthly-lineage", {
            monthlySplit: {
              groupTotalInWon: 120_000 - acceptedDifference,
              splitCount,
            },
          }),
        ],
      });
      const resultBeyondBoundary = subject.decide({
        observation: observation({ amountInWon: 120_000 }),
        candidates: [
          candidate("monthly-lineage", {
            monthlySplit: {
              groupTotalInWon: 120_000 - rejectedDifference,
              splitCount,
            },
          }),
        ],
      });

      expect(resultAtBoundary.kind).toBe("matched");
      expect(resultBeyondBoundary).toEqual({
        kind: "notFound",
        resource: "cancellationTarget",
      });
    },
  );

  it("[T-CAN-003] 완전 일치 lineage가 둘 이상이면 저장 순서로 선택하지 않고 확인이 필요하다고 반환한다", () => {
    const subject = createSubject();
    const candidates = [candidate("lineage-b"), candidate("lineage-a")];

    const forward = subject.decide({
      observation: observation(),
      candidates,
    });
    const reversed = subject.decide({
      observation: observation(),
      candidates: [...candidates].reverse(),
    });

    expect(forward.kind).toBe("needsConfirmation");
    expect(reversed.kind).toBe("needsConfirmation");
    if (
      forward.kind === "needsConfirmation" &&
      reversed.kind === "needsConfirmation"
    ) {
      expect([...forward.captureLineageIds].sort()).toEqual([
        "lineage-a",
        "lineage-b",
      ]);
      expect([...reversed.captureLineageIds].sort()).toEqual([
        "lineage-a",
        "lineage-b",
      ]);
    }
  });

  it("[T-CAN-003][CAN-002] 일반·월 분할 공통 후보 조회에 취소일과 30일 전을 모두 포함하는 범위를 만든다", () => {
    const result = createSubject().buildSearchWindow({
      cancellationDate: "2026-03-31",
      observedDate: "2026-03-31",
    });

    expect(result).toEqual({
      startDateInclusive: "2026-03-01",
      endDateInclusive: "2026-03-31",
    });
  });

  it("[T-CAN-003][CAN-002] 취소 날짜를 파싱하지 못한 경우 관찰 당일만 검색한다", () => {
    const result = createSubject().buildSearchWindow({
      cancellationDate: null,
      observedDate: "2026-03-31",
    });

    expect(result).toEqual({
      startDateInclusive: "2026-03-31",
      endDateInclusive: "2026-03-31",
    });
  });

  it.each([
    { difference: 0, expectedKind: "matched" },
    { difference: 1, expectedKind: "matched" },
    { difference: 2, expectedKind: "matched" },
    { difference: 3, expectedKind: "notFound" },
  ] as const)(
    "[T-CAN-006] 3개월 분할 합계가 취소액보다 $difference원 작을 때 $expectedKind를 반환한다",
    ({ difference, expectedKind }) => {
      const result = createSubject().decide({
        observation: observation({ amountInWon: 10_000 }),
        candidates: [
          candidate("monthly-lineage", {
            monthlySplit: {
              groupTotalInWon: 10_000 - difference,
              splitCount: 3,
            },
          }),
        ],
      });

      expect(result.kind).toBe(expectedKind);
    },
  );

  it("[T-CAN-006] 분할 합계가 취소액보다 크면 절댓값이 작아도 일치시키지 않는다", () => {
    const result = createSubject().decide({
      observation: observation({ amountInWon: 10_000 }),
      candidates: [
        candidate("monthly-lineage", {
          monthlySplit: { groupTotalInWon: 10_001, splitCount: 3 },
        }),
      ],
    });

    expect(result).toEqual({
      kind: "notFound",
      resource: "cancellationTarget",
    });
  });

  it("[T-CAN-006] 일반 거래에는 월 분할 내림 오차를 허용하지 않는다", () => {
    const result = createSubject().decide({
      observation: observation({ amountInWon: 10_000 }),
      candidates: [candidate("single-lineage", { amountInWon: 9_999 })],
    });

    expect(result).toEqual({
      kind: "notFound",
      resource: "cancellationTarget",
    });
  });
});
