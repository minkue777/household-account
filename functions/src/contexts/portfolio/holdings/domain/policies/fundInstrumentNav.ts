import { calculateAccountValuationPolicy } from "./accountValuation";

export interface FundInstrumentView {
  market: "KOFIA_FUND";
  instrumentType: "FUND";
  name: string;
  shortCode: "EW001";
  standardCode: "K55301EW0012";
  providerClassCode: "539502";
  provider: "miraeasset";
  priceScale: 1_000;
}

export interface FundNavObservation {
  provider: "miraeasset";
  providerFundCode: string;
  navDate: string;
  navPerThousandUnitsInWon: number;
  observedAt: string;
}

export type FundNavResult =
  | {
      kind: "success";
      instrument: FundInstrumentView;
      nav: FundNavObservation;
    }
  | { kind: "no-data"; code: "OFFICIAL_CLASS_NAV_NOT_OBSERVED" }
  | {
      kind: "contract-failure";
      code: "FUND_CLASS_CODE_MISMATCH" | "FUND_NAV_DATE_IN_FUTURE";
    };

export type FundSearchResult =
  | { kind: "success"; items: readonly FundInstrumentView[] }
  | { kind: "no-data" };

export type FundValuationValidationCode =
  | "FUND_CLASS_CODE_MISMATCH"
  | "INVALID_PRICE_SCALE"
  | "INVALID_QUANTITY"
  | "INVALID_AVERAGE_PURCHASE_NAV"
  | "INVALID_OFFICIAL_NAV";

export type FundValuationResult =
  | {
      kind: "success";
      evaluatedAmountInWon: number;
      costBasisInWon: number;
      navDate: string;
    }
  | {
      kind: "validation-error";
      code: FundValuationValidationCode;
    };

export interface SelectOfficialFundNavInput {
  instrument: FundInstrumentView;
  asOfDate: string;
  observations: readonly FundNavObservation[];
}

export interface ValueFundPositionInput {
  instrument: FundInstrumentView;
  quantity: number;
  averagePurchaseNavInWon: number;
  nav: FundNavObservation;
}

const GROWTH_FUND_CE: FundInstrumentView = {
  market: "KOFIA_FUND",
  instrumentType: "FUND",
  name: "미래에셋국민참여형국민성장혼합자산투자신탁(사모투자재간접형) 종류 C-e",
  shortCode: "EW001",
  standardCode: "K55301EW0012",
  providerClassCode: "539502",
  provider: "miraeasset",
  priceScale: 1_000,
};

function copyInstrument(instrument: FundInstrumentView): FundInstrumentView {
  return { ...instrument };
}

function copyNav(observation: FundNavObservation): FundNavObservation {
  return { ...observation };
}

function hasSupportedIdentity(instrument: FundInstrumentView): boolean {
  return (
    instrument.market === GROWTH_FUND_CE.market &&
    instrument.instrumentType === GROWTH_FUND_CE.instrumentType &&
    instrument.shortCode === GROWTH_FUND_CE.shortCode &&
    instrument.standardCode === GROWTH_FUND_CE.standardCode &&
    instrument.providerClassCode === GROWTH_FUND_CE.providerClassCode &&
    instrument.provider === GROWTH_FUND_CE.provider
  );
}

function isIsoLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function compareOfficialNavRecency(
  left: FundNavObservation,
  right: FundNavObservation,
): number {
  const dateOrder = right.navDate.localeCompare(left.navDate);
  if (dateOrder !== 0) {
    return dateOrder;
  }

  const leftObservedAt = Date.parse(left.observedAt);
  const rightObservedAt = Date.parse(right.observedAt);
  if (Number.isFinite(leftObservedAt) && Number.isFinite(rightObservedAt)) {
    return rightObservedAt - leftObservedAt;
  }
  return right.observedAt.localeCompare(left.observedAt);
}

function isUsableOfficialNav(observation: FundNavObservation): boolean {
  return (
    observation.provider === GROWTH_FUND_CE.provider &&
    observation.providerFundCode === GROWTH_FUND_CE.providerClassCode &&
    isIsoLocalDate(observation.navDate) &&
    Number.isFinite(observation.navPerThousandUnitsInWon) &&
    observation.navPerThousandUnitsInWon >= 0
  );
}

export function searchFundInstruments(query: string): FundSearchResult {
  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  if (normalizedQuery.length === 0) {
    return { kind: "no-data" };
  }

  const searchableValues = [
    GROWTH_FUND_CE.name,
    GROWTH_FUND_CE.shortCode,
    GROWTH_FUND_CE.standardCode,
    GROWTH_FUND_CE.providerClassCode,
  ].map((value) => value.toLocaleLowerCase("en-US"));

  return searchableValues.some((value) => value.includes(normalizedQuery))
    ? { kind: "success", items: [copyInstrument(GROWTH_FUND_CE)] }
    : { kind: "no-data" };
}

export function selectOfficialFundNav(
  input: SelectOfficialFundNavInput,
): FundNavResult {
  if (!hasSupportedIdentity(input.instrument)) {
    return {
      kind: "contract-failure",
      code: "FUND_CLASS_CODE_MISMATCH",
    };
  }

  const officialObservations = input.observations.filter(isUsableOfficialNav);
  const eligible = officialObservations
    .filter((observation) => observation.navDate <= input.asOfDate)
    .sort(compareOfficialNavRecency);

  if (eligible.length > 0) {
    return {
      kind: "success",
      instrument: copyInstrument(input.instrument),
      nav: copyNav(eligible[0]),
    };
  }

  if (
    isIsoLocalDate(input.asOfDate) &&
    officialObservations.some(
      (observation) => observation.navDate > input.asOfDate,
    )
  ) {
    return {
      kind: "contract-failure",
      code: "FUND_NAV_DATE_IN_FUTURE",
    };
  }

  return { kind: "no-data", code: "OFFICIAL_CLASS_NAV_NOT_OBSERVED" };
}

export function valueFundPosition(
  input: ValueFundPositionInput,
): FundValuationResult {
  if (!hasSupportedIdentity(input.instrument)) {
    return {
      kind: "validation-error",
      code: "FUND_CLASS_CODE_MISMATCH",
    };
  }
  if (input.instrument.priceScale !== GROWTH_FUND_CE.priceScale) {
    return { kind: "validation-error", code: "INVALID_PRICE_SCALE" };
  }
  if (
    input.nav.provider !== input.instrument.provider ||
    input.nav.providerFundCode !== input.instrument.providerClassCode
  ) {
    return {
      kind: "validation-error",
      code: "FUND_CLASS_CODE_MISMATCH",
    };
  }
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    return { kind: "validation-error", code: "INVALID_QUANTITY" };
  }
  if (
    !Number.isFinite(input.averagePurchaseNavInWon) ||
    input.averagePurchaseNavInWon < 0
  ) {
    return {
      kind: "validation-error",
      code: "INVALID_AVERAGE_PURCHASE_NAV",
    };
  }
  if (
    !Number.isFinite(input.nav.navPerThousandUnitsInWon) ||
    input.nav.navPerThousandUnitsInWon < 0
  ) {
    return { kind: "validation-error", code: "INVALID_OFFICIAL_NAV" };
  }

  const valuation = calculateAccountValuationPolicy([
    {
      positionId: "fund-position",
      kind: "fund",
      quantity: input.quantity,
      averagePrice: input.averagePurchaseNavInWon,
      currentPrice: input.nav.navPerThousandUnitsInWon,
      priceScale: input.instrument.priceScale,
    },
  ]);

  return {
    kind: "success",
    evaluatedAmountInWon: valuation.currentBalance,
    costBasisInWon: valuation.costBasis,
    navDate: input.nav.navDate,
  };
}
