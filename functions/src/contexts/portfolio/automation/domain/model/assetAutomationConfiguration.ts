export interface AssetAutomationConfiguration {
  readonly recurringContributionAmount: number;
  readonly recurringContributionDay: number;
  readonly lastAutoContributionMonth: string;
  readonly loanInterestRate: number;
  readonly loanRepaymentMethod: string;
  readonly loanMonthlyPaymentAmount: number;
  readonly loanPaymentDay: number;
  readonly lastAutoRepaymentMonth: string;
}

export const ASSET_AUTOMATION_FIELDS: readonly (keyof AssetAutomationConfiguration)[] = [
  "recurringContributionAmount", "recurringContributionDay", "lastAutoContributionMonth",
  "loanInterestRate", "loanRepaymentMethod", "loanMonthlyPaymentAmount", "loanPaymentDay",
  "lastAutoRepaymentMonth",
];

export interface AssetAutomationPlan {
  readonly planId: string;
  readonly householdId: string;
  readonly assetId: string;
  readonly operation: "savings-contribution" | "loan-repayment";
  readonly kind: "savings-deposit" | "loan-repayment";
  readonly status: "active" | "suspended" | "needs-attention" | "recovering-before-stop";
  readonly stopEffectiveAt?: string;
  readonly statusAfterRecovery?: "suspended";
  readonly amountInWon: number;
  readonly configuredDay: number;
  readonly firstActivatedOn: string;
  readonly activationMonthDisposition: "included" | "applicable";
  readonly firstApplicableMonth: string;
  readonly nextDueDate: string;
  readonly lastAppliedMonth?: string;
  readonly repaymentMethod?: string;
  readonly annualInterestRate?: number;
  readonly currentRevision: number;
  readonly aggregateVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Automation uses only identity, type and configuration; balance/positions/owners stay outside. */
export interface AssetAutomationSubject {
  readonly assetId: string;
  readonly householdId: string;
  readonly type: string;
  readonly subType?: string;
  readonly createdAt: string;
  readonly automation: AssetAutomationConfiguration;
}
