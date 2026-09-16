import { DEFAULT_HOME_SUMMARY_CONFIG, type HomeSummaryCardKey, type HomeSummaryConfig } from '@/types/household';

const HOME_SUMMARY_CARD_KEYS: HomeSummaryCardKey[] = [
  'localCurrencyBalance',
  'monthlyRemainingBudget',
  'monthlySpent',
  'yearlySpent',
];

function isHomeSummaryCardKey(value: unknown): value is HomeSummaryCardKey {
  return typeof value === 'string' && HOME_SUMMARY_CARD_KEYS.includes(value as HomeSummaryCardKey);
}

export function resolveHomeSummaryConfig(value: unknown): HomeSummaryConfig {
  const leftCard =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>).leftCard : null;
  const rightCard =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>).rightCard : null;

  return {
    leftCard: isHomeSummaryCardKey(leftCard)
      ? leftCard
      : DEFAULT_HOME_SUMMARY_CONFIG.leftCard,
    rightCard: isHomeSummaryCardKey(rightCard)
      ? rightCard
      : DEFAULT_HOME_SUMMARY_CONFIG.rightCard,
  };
}
