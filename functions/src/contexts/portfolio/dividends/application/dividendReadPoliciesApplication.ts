import {
  estimateUpcomingDividends,
  normalizeAnnualDividends,
} from "../domain/policies/dividendReadPolicies";
import type { DividendReadPolicies } from "./ports/in/dividendReadPolicies";

export function createDividendReadPoliciesApplication(): DividendReadPolicies {
  return {
    normalizeAnnual: normalizeAnnualDividends,
    estimateUpcoming: estimateUpcomingDividends,
  };
}
