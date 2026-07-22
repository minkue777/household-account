import type { AssetOwnerProfileWireView } from './accessContractTypes';

export const HOUSEHOLD_QUERY_CONTRACT_VERSION = 'household-query.v1' as const;
export const HOUSEHOLD_QUERY_RESPONSE_CONTRACT_VERSION =
  'household-query-response.v1' as const;

export interface HouseholdQueryPayloads {
  'ledger.list-transactions.v1': {
    startDate: string;
    endDate: string;
    transactionType: 'expense' | 'income';
  };
  'shortcut.get-credential-status.v1': Record<string, never>;
  'portfolio.search-instruments.v1': {
    assetClass: 'stock' | 'crypto';
    query: string;
    limit?: number;
  };
  'portfolio.get-instrument-quote.v1': {
    market: PortfolioQueryMarket;
    code: string;
    name?: string;
    instrumentType?: PortfolioQueryInstrumentType;
    priceScale?: number;
  };
  'portfolio.get-dividend-projection.v1': {
    instrumentCode: string;
  };
  'access.list-asset-owner-profiles.v1': { includeArchived?: boolean };
}

export interface LedgerRangeQueryTransaction {
  id: string;
  aggregateVersion: number;
  date: string;
  time?: string;
  merchant: string;
  amount: number;
  transactionType: 'expense' | 'income';
  category: string;
  cardType?: string;
  cardDisplay?: string;
  memo?: string;
  mergedFrom?: Array<{
    merchant: string;
    amount: number;
    category: string;
    memo?: string;
  }>;
  splitGroupId?: string;
  splitIndex?: number;
  splitTotal?: number;
}

export type PortfolioQueryMarket =
  | 'KRX'
  | 'US'
  | 'KOFIA_FUND'
  | 'UPBIT_KRW'
  | 'PHYSICAL_GOLD';

export type PortfolioQueryInstrumentType =
  | 'stock'
  | 'etf'
  | 'etn'
  | 'fund'
  | 'crypto'
  | 'gold';

export interface PortfolioQueryInstrument {
  market: PortfolioQueryMarket;
  instrumentType: PortfolioQueryInstrumentType;
  code: string;
  name: string;
  priceScale?: number;
}

export interface PortfolioQuoteQueryResult {
  instrument: PortfolioQueryInstrument;
  priceInWon: number;
  observedAt: string;
  provider: string;
  quoteAsOf?: string;
}

export interface PortfolioDividendProjectionQueryResult {
  code: string;
  name: string;
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
  annualDividendPerShare: number | null;
  isEstimated: false;
  paymentEvents: Array<{ paymentDate: string; dividend: number }>;
}

export interface HouseholdQueryResults {
  'ledger.list-transactions.v1': {
    transactions: LedgerRangeQueryTransaction[];
  };
  'shortcut.get-credential-status.v1':
    | {
        kind: 'found';
        credential: {
          credentialId: string;
          credentialVersion: number;
          status: 'active' | 'revoked';
          masked: true;
          issuedAt: string;
          lastUsedAt?: string;
        };
      }
    | { kind: 'notFound' };
  'portfolio.search-instruments.v1': {
    items: PortfolioQueryInstrument[];
    truncated: boolean;
    stale: boolean;
    catalogAsOf?: string;
    catalogVersion?: string;
  };
  'portfolio.get-instrument-quote.v1': PortfolioQuoteQueryResult;
  'portfolio.get-dividend-projection.v1': PortfolioDividendProjectionQueryResult;
  'access.list-asset-owner-profiles.v1': { profiles: AssetOwnerProfileWireView[] };
}

export type HouseholdQueryName = keyof HouseholdQueryPayloads & keyof HouseholdQueryResults;

export interface HouseholdQueryEnvelope<Name extends HouseholdQueryName = HouseholdQueryName> {
  contractVersion: typeof HOUSEHOLD_QUERY_CONTRACT_VERSION;
  queryId: string;
  householdId: string;
  query: Name;
  payload: HouseholdQueryPayloads[Name];
}

export type HouseholdQueryOutcome<Result> =
  | { kind: 'succeeded'; value: Result }
  | { kind: 'rejected'; error: { code: string; retryable: boolean } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseHouseholdQueryWireResponse<Result>(
  value: unknown,
  expectedQueryId: string
): HouseholdQueryOutcome<Result> {
  if (!isRecord(value) || value.contractVersion !== HOUSEHOLD_QUERY_RESPONSE_CONTRACT_VERSION) {
    throw new Error('지원하지 않는 조회 응답 계약입니다.');
  }
  if (value.queryId !== expectedQueryId || !isRecord(value.result)) {
    throw new Error('조회 응답이 요청과 일치하지 않습니다.');
  }
  if (value.result.kind === 'succeeded' && 'value' in value.result) {
    return value.result as HouseholdQueryOutcome<Result>;
  }
  if (
    value.result.kind === 'rejected' &&
    isRecord(value.result.error) &&
    typeof value.result.error.code === 'string' &&
    typeof value.result.error.retryable === 'boolean'
  ) {
    return value.result as HouseholdQueryOutcome<Result>;
  }
  throw new Error('알 수 없는 조회 결과입니다.');
}
