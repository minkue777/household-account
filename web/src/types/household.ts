// 가구 멤버
export interface HouseholdMember {
  id: string;
  name: string;
  aggregateVersion: number;
}

export type HomeSummaryCardKey =
  | 'localCurrencyBalance'
  | 'monthlyRemainingBudget'
  | 'monthlySpent'
  | 'yearlySpent';

export interface HomeSummaryConfig {
  leftCard: HomeSummaryCardKey;
  rightCard: HomeSummaryCardKey;
}

export const DEFAULT_HOME_SUMMARY_CONFIG: HomeSummaryConfig = {
  leftCard: 'localCurrencyBalance',
  rightCard: 'monthlyRemainingBudget',
};

export interface Household {
  id: string;
  name: string;
  createdAt: Date;
  defaultCategoryKey?: string;
  homeSummaryConfig?: HomeSummaryConfig;
  members: HouseholdMember[];
}
