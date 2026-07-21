import {
  refreshAndValueHoldingPosition,
  valueHoldingAccount,
  valueHoldingPosition,
} from "../domain/policies/holdingValuationPolicy";
import type { HoldingValuation } from "./ports/in/holdingValuation";

export function createHoldingValuationApplication(): HoldingValuation {
  return {
    valuePosition: valueHoldingPosition,
    refreshAndValue: refreshAndValueHoldingPosition,
    valueAccount: valueHoldingAccount,
  };
}
