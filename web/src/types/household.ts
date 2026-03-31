// 가구 멤버
export interface HouseholdMember {
  id: string;
  name: string;
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

export interface AndroidBridge {
  setHouseholdKey: (key: string) => void;
  getHouseholdKey: () => string;
  clearHouseholdKey: () => void;
  setMemberName: (name: string) => void;
  setPartnerName: (name: string) => void;
  getAppVersion?: () => string;
}

export interface WindowWithBridge extends Window {
  AndroidBridge?: AndroidBridge;
}
