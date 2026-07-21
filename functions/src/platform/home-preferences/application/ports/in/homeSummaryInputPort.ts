import type {
  HomeCardSourceState,
  HomeCardType,
} from "../../../domain/homeSummary";

export type { HomeCardSourceState, HomeCardType } from "../../../domain/homeSummary";

export interface HomeSummaryView {
  readonly configurationSource: "DEFAULT" | "SAVED" | "LEGACY";
  readonly cards: readonly {
    readonly slot: "left" | "right";
    readonly type: HomeCardType;
    readonly state: HomeCardSourceState;
  }[];
  readonly income: { readonly monthlyInWon: number; readonly yearlyInWon: number };
  readonly partial: boolean;
}

export interface HomeSummaryInputPort {
  getSummary(input: {
    readonly householdId: string;
    readonly memberId: string;
    readonly accountingMonth: string;
  }): Promise<{ readonly kind: "success"; readonly value: HomeSummaryView }>;
}
