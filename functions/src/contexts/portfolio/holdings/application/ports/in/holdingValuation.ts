import type {
  HoldingAccountValuationResult,
  MarketResult,
  PositionValuationInput,
  PositionValuationResult,
  RefreshedPositionResult,
} from "../../../domain/model/holdingValuation";

export interface HoldingValuation {
  valuePosition(input: PositionValuationInput): PositionValuationResult;
  refreshAndValue(
    input: PositionValuationInput,
    marketResult: MarketResult,
  ): RefreshedPositionResult;
  valueAccount(
    inputs: readonly PositionValuationInput[],
  ): HoldingAccountValuationResult;
}
