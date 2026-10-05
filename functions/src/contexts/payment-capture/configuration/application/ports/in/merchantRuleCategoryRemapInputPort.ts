export interface RemappableMerchantRule {
  readonly ruleId: string;
  readonly householdId: string;
  readonly keyword: string;
  readonly matchType: "exact" | "startsWith" | "endsWith" | "contains";
  readonly priority?: number;
  readonly active: boolean;
  readonly mapping: {
    readonly merchant?: string;
    readonly categoryId?: string;
    readonly memo?: string;
  };
  readonly version: number;
}

