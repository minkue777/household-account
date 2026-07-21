import {
  calculateEffectivePaymentDatePolicy,
  type EffectivePaymentDateResult,
} from "./domain/policies/effectivePaymentDate";
import {
  firstMonthForInitialActivationPolicy,
  type FirstAutomationMonthInput,
  type FirstAutomationMonthResult,
} from "./domain/policies/firstAutomationMonth";
import {
  calculateLoanPrincipalPaymentPolicy,
  type LoanPrincipalPaymentInput,
  type LoanPrincipalPaymentResult,
} from "./domain/policies/loanPrincipalPayment";
import {
  evaluateSavingsContributionPolicy,
  type SavingsContributionInput,
  type SavingsContributionResult,
} from "./domain/policies/savingsContribution";

export type { EffectivePaymentDateResult } from "./domain/policies/effectivePaymentDate";
export { calculateEffectivePaymentDatePolicy } from "./domain/policies/effectivePaymentDate";
export {
  nextYearMonth,
  parseYearMonth,
} from "./domain/value-objects/yearMonth";
export type {
  FirstAutomationMonthInput,
  FirstAutomationMonthResult,
} from "./domain/policies/firstAutomationMonth";
export type {
  LoanPrincipalPaymentInput,
  LoanPrincipalPaymentResult,
  LoanRepaymentMethod,
} from "./domain/policies/loanPrincipalPayment";
export type {
  SavingsContributionInput,
  SavingsContributionResult,
} from "./domain/policies/savingsContribution";

export interface AssetAutomationDatePolicy {
  calculateEffectivePaymentDate(
    yearMonth: string,
    configuredDay: number,
  ): EffectivePaymentDateResult;
  firstMonthForInitialActivation(
    input: FirstAutomationMonthInput,
  ): FirstAutomationMonthResult;
  evaluateSavings(input: SavingsContributionInput): SavingsContributionResult;
  calculateLoanPrincipal(input: LoanPrincipalPaymentInput): LoanPrincipalPaymentResult;
}

export function createAssetAutomationDatePolicy(): AssetAutomationDatePolicy {
  return {
    calculateEffectivePaymentDate: calculateEffectivePaymentDatePolicy,
    firstMonthForInitialActivation: firstMonthForInitialActivationPolicy,
    evaluateSavings: evaluateSavingsContributionPolicy,
    calculateLoanPrincipal: calculateLoanPrincipalPaymentPolicy,
  };
}

export type { LoanRepaymentWorkflow } from "./application/ports/in/loanRepaymentWorkflow";
export type {
  AutomationAppliedEvent,
  LoanEvaluation,
  LoanPlan,
  RunRepaymentResult,
} from "./domain/model/loanRepaymentWorkflow";

export type { AssetAutomationExecution } from "./application/ports/in/assetAutomationExecution";
export { createAssetAutomationScheduledApplication } from "./application/assetAutomationScheduledApplication";
export type { ProcessDueAssetAutomation } from "./application/ports/in/processDueAssetAutomation";
export type {
  AssetAutomationOperation,
  AssetAutomationPageResult,
  AssetAutomationTargetResult,
  DueAssetAutomationPlan,
} from "./domain/model/assetAutomationRuntime";
export type {
  AssetAutomationAppliedEvent,
  AutomatedAssetView,
  AutomationExecutionView,
  AutomationKind,
  AutomationPlanView,
  AutomationReceipt,
  AutomationRevisionView,
  AutomationRunResult,
} from "./domain/model/assetAutomationExecution";
