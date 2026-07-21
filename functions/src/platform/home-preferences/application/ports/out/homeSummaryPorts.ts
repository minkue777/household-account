import type {
  HomeCardSourceState,
  HomeCardType,
} from "../../../domain/homeSummary";

export interface HomeConfigurationQueryPort {
  get(input: { readonly householdId: string }): Promise<
    | {
        readonly left: string;
        readonly right: string;
        readonly source: "SAVED" | "LEGACY";
      }
    | undefined
  >;
}

export interface HomeCardSourceQueryPort {
  get(input: {
    readonly cardType: HomeCardType;
    readonly householdId: string;
    readonly memberId: string;
    readonly accountingMonth: string;
  }): Promise<HomeCardSourceState>;
}

export interface HomeIncomeQueryPort {
  get(input: {
    readonly householdId: string;
    readonly memberId: string;
    readonly accountingMonth: string;
  }): Promise<{ readonly monthlyInWon: number; readonly yearlyInWon: number }>;
}
