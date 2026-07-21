import { createGoldPositionApplication } from "../../src/contexts/portfolio/holdings/application/goldPositionApplication";
import type { GoldPositionStore } from "../../src/contexts/portfolio/holdings/application/ports/out/goldPositionStore";
import type {
  GoldPositionView,
  GoldValuationEvent,
} from "../../src/contexts/portfolio/holdings/public";

export function createGoldPositionAndProviderFixture(seed: {
  currentPosition: GoldPositionView;
}) {
  let current = { ...seed.currentPosition };
  const events: GoldValuationEvent[] = [];
  const store: GoldPositionStore = {
    current: () => ({ ...current }),
    commit: ({ position, events: recorded }) => {
      current = { ...position };
      events.push(...recorded.map((event) => ({ ...event })));
    },
    events: () => events.map((event) => ({ ...event })),
  };
  return createGoldPositionApplication(store);
}
