import type {
  GoldPositionView,
  GoldProviderResult,
  GoldValuationEvent,
  NormalizeGoldInput,
  RefreshGoldResult,
} from "../../../domain/model/goldPosition";

export interface GoldPosition {
  normalizeAndValue(input: NormalizeGoldInput): GoldPositionView;
  refreshPhysicalGold(result: GoldProviderResult): RefreshGoldResult;
  currentPosition(): GoldPositionView;
  recordedEvents(): readonly GoldValuationEvent[];
}
