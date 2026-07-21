import { createHomeSummaryApplication } from "../../src/platform/home-preferences/application/homeSummaryApplication";
import type {
  HomeCardSourceState,
  HomeCardType,
} from "../../src/platform/home-preferences/public";

type SourceResult =
  | { readonly kind: "ready"; readonly amountInWon: number; readonly asOf: string }
  | { readonly kind: "no-data"; readonly reason: string }
  | { readonly kind: "retryable-failure"; readonly code: string };

function normalize(source: SourceResult | undefined): HomeCardSourceState {
  if (source === undefined) return { kind: "NO_DATA", reason: "HOME_SOURCE_NOT_AVAILABLE" };
  if (source.kind === "ready") {
    return { kind: "READY", amountInWon: source.amountInWon, asOf: source.asOf };
  }
  if (source.kind === "no-data") return { kind: "NO_DATA", reason: source.reason };
  return { kind: "FAILED", code: source.code, retryable: true };
}

export function createHomeSummarySourceStateFixture(seed: {
  readonly configuration: { readonly left: HomeCardType; readonly right: HomeCardType };
  readonly sources: Readonly<Partial<Record<HomeCardType, SourceResult>>>;
}) {
  const application = createHomeSummaryApplication({
    configuration: {
      get: async () => ({ ...seed.configuration, source: "SAVED" as const }),
    },
    sources: { get: async ({ cardType }) => normalize(seed.sources[cardType]) },
    income: { get: async () => ({ monthlyInWon: 0, yearlyInWon: 0 }) },
  });
  return {
    async getSummary(input: {
      readonly householdId: string;
      readonly memberId: string;
      readonly period: { readonly year: number; readonly month: number };
    }) {
      const result = await application.getSummary({
        householdId: input.householdId,
        memberId: input.memberId,
        accountingMonth: `${input.period.year}-${String(input.period.month).padStart(2, "0")}`,
      });
      return {
        kind: "success" as const,
        value: {
          cards: result.value.cards.map(({ slot, type, state }) => {
            const publicState =
              state.kind === "FAILED"
                ? { kind: "FAILED" as const, code: state.code, retryable: true as const }
                : state;
            return { slot, cardType: type, state: publicState };
          }),
          overall: result.value.partial ? ("PARTIAL" as const) : ("COMPLETE" as const),
        },
      };
    },
  };
}
