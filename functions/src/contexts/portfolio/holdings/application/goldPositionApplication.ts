import type {
  GoldPositionView,
  RefreshGoldResult,
} from "../domain/model/goldPosition";
import { normalizeAndValueGold } from "../domain/policies/goldPositionPolicy";
import type { GoldPosition } from "./ports/in/goldPosition";
import type { GoldPositionStore } from "./ports/out/goldPositionStore";

export function createGoldPositionApplication(
  store: GoldPositionStore,
): GoldPosition {
  return {
    normalizeAndValue: normalizeAndValueGold,
    refreshPhysicalGold(result): RefreshGoldResult {
      const current = store.current();
      if (result.kind !== "success") {
        return {
          kind:
            result.kind === "retryable-failure"
              ? "partial-failure"
              : "contract-failure",
          code:
            result.kind === "fixed-fallback"
              ? "ESTIMATED_GOLD_FALLBACK_FORBIDDEN"
              : result.code,
          retained: current,
        };
      }

      const value: GoldPositionView = {
        ...normalizeAndValueGold({
          positionId: current.positionId,
          kind: "physical-gold",
          quantity: current.normalizedQuantity,
          quoteInWon: result.wonPerDon,
        }),
        quoteObservedAt: result.observedAt,
      };
      store.commit({
        position: value,
        events: [
          { eventType: "PositionChanged.v1" },
          { eventType: "AssetValuationChanged.v1" },
        ],
      });
      return { kind: "success", value };
    },
    currentPosition: () => store.current(),
    recordedEvents: () => store.events(),
  };
}
