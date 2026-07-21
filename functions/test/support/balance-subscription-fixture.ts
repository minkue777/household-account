import { createBalanceSubscriptionApplication } from "../../src/contexts/household-finance/local-currency/application/balanceSubscriptionApplication";
import type {
  BalanceSourceOccurrence,
  BalanceSubscriptionSource,
} from "../../src/contexts/household-finance/local-currency/application/ports/outbound/balanceSubscriptionSource";

export function createBalanceSubscriptionFixtureSubject(fixture: {
  occurrences: readonly BalanceSourceOccurrence[];
}) {
  let activeSubscriptionCount = 0;
  let sequence = 0;
  const source: BalanceSubscriptionSource = {
    occurrences: async () => fixture.occurrences,
  };
  const subscription = createBalanceSubscriptionApplication({
    source,
    idGenerator: { next: () => `balance-subscription-${++sequence}` },
    onSubscriptionCreated: () => {
      activeSubscriptionCount += 1;
    },
  });
  return {
    ...subscription,
    activeSubscriptionCount: () => activeSubscriptionCount,
  };
}
