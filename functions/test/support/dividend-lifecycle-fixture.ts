import { createDividendLifecycleApplication } from "../../src/contexts/portfolio/dividends/application/dividendLifecycleApplication";
import type {
  DividendLifecycleRepository,
  DividendLifecycleState,
  DividendPositionSnapshotReader,
} from "../../src/contexts/portfolio/dividends/application/ports/out/dividendLifecyclePorts";
import type {
  DividendIntegrationEvent,
  PositionSnapshot,
} from "../../src/contexts/portfolio/dividends/public";

export function createDividendLifecycleFixture(fixture: {
  positionSnapshots?: readonly PositionSnapshot[];
} = {}) {
  let state: DividendLifecycleState = { events: [], receipts: {} };
  const integrationEvents: DividendIntegrationEvent[] = [];
  const repository: DividendLifecycleRepository = {
    state: () => structuredClone(state),
    commit: (input) => {
      state = structuredClone(input.state);
      integrationEvents.push(
        ...input.integrationEvents.map((event) => ({ ...event })),
      );
    },
    integrationEvents: () =>
      integrationEvents.map((event) => ({ ...event })),
  };
  const snapshotReader: DividendPositionSnapshotReader = {
    snapshots: () =>
      (fixture.positionSnapshots ?? []).map((snapshot) => ({ ...snapshot })),
  };
  return createDividendLifecycleApplication({ repository, snapshotReader });
}
