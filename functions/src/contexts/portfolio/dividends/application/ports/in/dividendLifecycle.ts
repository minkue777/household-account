import type {
  AnnualDividendProjection,
  DividendCommandResult,
  DividendDisclosure,
  DividendEventView,
  DividendIntegrationEvent,
} from "../../../domain/model/dividendLifecycle";

export interface DividendLifecycle {
  upsertAnnouncement(command: {
    commandId: string;
    idempotencyKey: string;
    householdId: string;
    disclosure: DividendDisclosure;
  }): Promise<DividendCommandResult>;
  advanceStatus(command: {
    commandId: string;
    idempotencyKey: string;
    householdId: string;
    eventId: string;
    asOfDate: string;
  }): Promise<DividendCommandResult>;
  observeDisclosureNoData(
    sourceDisclosureId: string,
  ): Promise<DividendCommandResult>;
  queryEvents(
    householdId: string,
    year: number,
  ): Promise<readonly DividendEventView[]>;
  rebuildAnnual(
    householdId: string,
    year: number,
  ): Promise<AnnualDividendProjection>;
  recordedIntegrationEvents(): readonly DividendIntegrationEvent[];
}
