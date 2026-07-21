import { describe, expect, it } from "vitest";
import {
  searchFundInstruments,
  selectOfficialFundNav,
  valueFundPosition,
  type FundInstrumentView,
  type FundNavObservation,
  type FundNavResult,
  type FundSearchResult,
  type FundValuationResult,
} from "../../../src/contexts/portfolio/holdings/public";

/** 지원 펀드 identity·공식 일별 기준가·평가 계약입니다. */
export interface FundInstrumentNavSubject {
  search(query: string): FundSearchResult;
  selectOfficialNav(input: {
    instrument: FundInstrumentView;
    asOfDate: string;
    observations: readonly FundNavObservation[];
  }): FundNavResult;
  valuePosition(input: {
    instrument: FundInstrumentView;
    quantity: number;
    averagePurchaseNavInWon: number;
    nav: FundNavObservation;
  }): FundValuationResult;
}

export function createSubject(): FundInstrumentNavSubject {
  return {
    search: searchFundInstruments,
    selectOfficialNav: selectOfficialFundNav,
    valuePosition: valueFundPosition,
  };
}

const growthFund: FundInstrumentView = {
  market: "KOFIA_FUND",
  instrumentType: "FUND",
  name: "미래에셋국민참여형국민성장혼합자산투자신탁(사모투자재간접형) 종류 C-e",
  shortCode: "EW001",
  standardCode: "K55301EW0012",
  providerClassCode: "539502",
  provider: "miraeasset",
  priceScale: 1_000,
};

function nav(
  providerFundCode: string,
  navDate: string,
  navPerThousandUnitsInWon: number,
): FundNavObservation {
  return {
    provider: "miraeasset",
    providerFundCode,
    navDate,
    navPerThousandUnitsInWon,
    observedAt: `${navDate}T23:55:00+09:00`,
  };
}

describe("국민성장펀드 identity·NAV 계약", () => {
  it.each(["EW001", "K55301EW0012", "539502", "국민성장", "C-e"])(
    "[T-FUND-001][FUND-001] 검색어 %s로 정확한 C-e 클래스 identity를 반환한다",
    (query) => {
      expect(createSubject().search(query)).toEqual({
        kind: "success",
        items: [growthFund],
      });
    },
  );

  it("[T-FUND-001][FUND-001] 오늘보다 미래가 아닌 C-e 클래스의 가장 최근 공식 NAV를 선택한다", () => {
    const result = createSubject().selectOfficialNav({
      instrument: growthFund,
      asOfDate: "2026-07-20",
      observations: [
        nav("539502", "2026-07-18", 1_000.1),
        nav("539502", "2026-07-19", 1_001.19),
        nav("539502", "2026-07-21", 1_002.5),
      ],
    });

    expect(result).toEqual({
      kind: "success",
      instrument: growthFund,
      nav: nav("539502", "2026-07-19", 1_001.19),
    });
  });

  it.each([
    ["539500", "C 클래스"],
    ["EV880", "모펀드"],
  ] as const)(
    "[T-FUND-001][FUND-001] %s %s NAV를 C-e 클래스 값으로 대신 사용하지 않는다",
    (providerFundCode, _label) => {
      expect(
        createSubject().selectOfficialNav({
          instrument: growthFund,
          asOfDate: "2026-07-20",
          observations: [nav(providerFundCode, "2026-07-19", 1_500)],
        }),
      ).toEqual({
        kind: "no-data",
        code: "OFFICIAL_CLASS_NAV_NOT_OBSERVED",
      });
    },
  );

  it("[T-FUND-001][FUND-001] 실제 보유좌수와 1,000좌당 공식 기준가로 평가액·원가를 계산한다", () => {
    expect(
      createSubject().valuePosition({
        instrument: growthFund,
        quantity: 30_000_000,
        averagePurchaseNavInWon: 1_000,
        nav: nav("539502", "2026-07-19", 1_001.19),
      }),
    ).toEqual({
      kind: "success",
      evaluatedAmountInWon: 30_035_700,
      costBasisInWon: 30_000_000,
      navDate: "2026-07-19",
    });
  });

  it("[T-FUND-001][FUND-001] 지원 identity를 다른 클래스로 바꾼 요청은 거부한다", () => {
    const otherClass = {
      ...growthFund,
      providerClassCode: "539500",
    } as unknown as FundInstrumentView;

    expect(
      createSubject().selectOfficialNav({
        instrument: otherClass,
        asOfDate: "2026-07-20",
        observations: [nav("539500", "2026-07-19", 1_500)],
      }),
    ).toEqual({
      kind: "contract-failure",
      code: "FUND_CLASS_CODE_MISMATCH",
    });
  });

  it("[T-FUND-001][FUND-001] 미래 날짜의 C-e NAV만 있으면 공식 현재값으로 사용하지 않는다", () => {
    expect(
      createSubject().selectOfficialNav({
        instrument: growthFund,
        asOfDate: "2026-07-20",
        observations: [nav("539502", "2026-07-21", 1_002.5)],
      }),
    ).toEqual({
      kind: "contract-failure",
      code: "FUND_NAV_DATE_IN_FUTURE",
    });
  });

  it("[T-FUND-001][FUND-001] 1,000좌가 아닌 priceScale로 펀드 평가를 수행하지 않는다", () => {
    const wrongScale = {
      ...growthFund,
      priceScale: 1,
    } as unknown as FundInstrumentView;

    expect(
      createSubject().valuePosition({
        instrument: wrongScale,
        quantity: 30_000_000,
        averagePurchaseNavInWon: 1_000,
        nav: nav("539502", "2026-07-19", 1_001.19),
      }),
    ).toEqual({
      kind: "validation-error",
      code: "INVALID_PRICE_SCALE",
    });
  });
});
