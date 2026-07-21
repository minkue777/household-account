import {
  DEFAULT_HOME_CONFIGURATION,
  isHomeCardType,
  type HomeCardType,
} from "../domain/homeSummary";
import type { HomeSummaryInputPort } from "./ports/in/homeSummaryInputPort";
import type {
  HomeCardSourceQueryPort,
  HomeConfigurationQueryPort,
  HomeIncomeQueryPort,
} from "./ports/out/homeSummaryPorts";

export function createHomeSummaryApplication(dependencies: {
  readonly configuration: HomeConfigurationQueryPort;
  readonly sources: HomeCardSourceQueryPort;
  readonly income: HomeIncomeQueryPort;
}): HomeSummaryInputPort {
  return {
    async getSummary(input) {
      const stored = await dependencies.configuration.get({
        householdId: input.householdId,
      });
      let left: HomeCardType = DEFAULT_HOME_CONFIGURATION.left;
      let right: HomeCardType = DEFAULT_HOME_CONFIGURATION.right;
      let configurationSource: "DEFAULT" | "SAVED" | "LEGACY" = "DEFAULT";
      if (
        stored !== undefined &&
        isHomeCardType(stored.left) &&
        isHomeCardType(stored.right)
      ) {
        left = stored.left;
        right = stored.right;
        configurationSource = stored.source;
      }
      const selected: readonly [HomeCardType, HomeCardType] = [left, right];
      const states = new Map<HomeCardType, Awaited<ReturnType<HomeCardSourceQueryPort["get"]>>>();
      for (const cardType of new Set<HomeCardType>(selected)) {
        states.set(
          cardType,
          await dependencies.sources.get({ cardType, ...input }),
        );
      }
      const cards = (["left", "right"] as const).map((slot, index) => ({
        slot,
        type: selected[index],
        state: states.get(selected[index])!,
      }));
      const income = await dependencies.income.get(input);
      return {
        kind: "success" as const,
        value: {
          configurationSource,
          cards,
          income,
          partial: cards.some(({ state }) => state.kind !== "READY"),
        },
      };
    },
  };
}
