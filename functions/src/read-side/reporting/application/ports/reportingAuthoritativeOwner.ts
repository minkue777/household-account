import type {
  ReportingAuthoritativeProjection,
  ReportingOwnedAction,
  ReportingOwnedActionUpstreamResult,
} from "../../model/reportingAuthoritativeAction";

export interface ReportingOwnedActionGateway {
  execute(
    action: ReportingOwnedAction,
  ): Promise<ReportingOwnedActionUpstreamResult>;
}

export interface ReportingAuthoritativeStateQueryPort {
  refresh(): Promise<ReportingAuthoritativeProjection>;
}
