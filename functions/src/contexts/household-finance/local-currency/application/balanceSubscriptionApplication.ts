import type {
  BalanceReadState,
  BalanceSubscriptionInputPort,
} from "./ports/in/balanceSubscriptionPort";
import type {
  BalanceSubscriptionIdGenerator,
  BalanceSubscriptionSource,
} from "./ports/outbound/balanceSubscriptionSource";
import type { BalanceView } from "./ports/in/localCurrencyBalancePort";

function compareBalanceRecency(left: BalanceView, right: BalanceView): number {
  return (
    left.observedAt.localeCompare(right.observedAt) ||
    left.balanceVersion - right.balanceVersion ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.balanceId.localeCompare(right.balanceId)
  );
}

export function createBalanceSubscriptionApplication(input: {
  source: BalanceSubscriptionSource;
  idGenerator: BalanceSubscriptionIdGenerator;
  onSubscriptionCreated?: () => void;
}): BalanceSubscriptionInputPort {
  return {
    subscribe: async (request) => {
      if (request.selectedLocalCurrencyType === undefined) {
        return {
          kind: "selection-required",
          code: "LOCAL_CURRENCY_TYPE_REQUIRED",
        };
      }
      const subscriptionId = input.idGenerator.next();
      input.onSubscriptionCreated?.();
      const occurrences = await input.source.occurrences({
        householdId: request.householdId,
        localCurrencyType: request.selectedLocalCurrencyType,
      });
      const states: BalanceReadState[] = [{ kind: "loading" }];
      for (const occurrence of occurrences) {
        if (occurrence.kind === "failure") {
          states.push({
            kind: "failed",
            code: occurrence.code,
            retryable: occurrence.retryable,
          });
          continue;
        }
        const latest = occurrence.documents
          .filter(
            (document) =>
              document.householdId === request.householdId &&
              document.localCurrencyType === request.selectedLocalCurrencyType,
          )
          .sort(compareBalanceRecency)
          .at(-1);
        states.push(
          latest === undefined
            ? { kind: "no-data", code: "BALANCE_NOT_OBSERVED" }
            : { kind: "data", value: { ...latest } },
        );
      }
      return { kind: "subscribed", subscriptionId, states };
    },
  };
}
