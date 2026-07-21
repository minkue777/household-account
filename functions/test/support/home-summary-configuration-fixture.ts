import { createHomeSummaryApplication } from "../../src/platform/home-preferences/application/homeSummaryApplication";
import type {
  HomeCardSourceState,
  HomeCardType,
} from "../../src/platform/home-preferences/public";

export function createHomeSummaryConfigurationFixture(fixture: {
  readonly configuration?: {
    readonly left: string;
    readonly right: string;
    readonly source: "SAVED" | "LEGACY";
  };
  readonly sources?: Partial<Record<HomeCardType, HomeCardSourceState>>;
  readonly ledgerIncome?: { readonly monthlyInWon: number; readonly yearlyInWon: number };
} = {}) {
  return createHomeSummaryApplication({
    configuration: { get: async () => fixture.configuration },
    sources: {
      async get({ cardType }) {
        return fixture.sources?.[cardType] ?? {
          kind: "NO_DATA",
          reason: "HOME_SOURCE_NOT_AVAILABLE",
        };
      },
    },
    income: {
      get: async () => fixture.ledgerIncome ?? { monthlyInWon: 0, yearlyInWon: 0 },
    },
  });
}
