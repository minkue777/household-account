import type {
  BoundedLedgerSourceResponse,
  ReportingRequestIdentity,
} from "../../model/boundedReporting";

export interface BoundedLedgerSourcePort {
  load(input: {
    identity: ReportingRequestIdentity;
    period: { startDate: string; endDate: string };
  }): Promise<BoundedLedgerSourceResponse>;
}
