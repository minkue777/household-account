import type {
  DividendCommandResult,
  DividendIntegrationEvent,
  PositionSnapshot,
  StoredDividendEvent,
} from "../../../domain/model/dividendLifecycle";

export interface DividendLifecycleState {
  events: readonly StoredDividendEvent[];
  receipts: Readonly<Record<string, DividendCommandResult>>;
}

export interface DividendLifecycleRepository {
  state(): DividendLifecycleState;
  commit(input: {
    state: DividendLifecycleState;
    integrationEvents: readonly DividendIntegrationEvent[];
  }): void;
  integrationEvents(): readonly DividendIntegrationEvent[];
}

export interface DividendPositionSnapshotReader {
  snapshots(): readonly PositionSnapshot[];
}
