import type {
  ReportingCategoryAction,
  ReportingCategoryDetailRow,
  ReportingUpstreamActionResult,
} from "../../model/reportingCategoryAction";

export interface ReportingCategoryActionGateway {
  execute(
    action: ReportingCategoryAction,
  ): Promise<ReportingUpstreamActionResult>;
}

export interface ReportingCategoryDetailQueryPort {
  refresh(): Promise<readonly ReportingCategoryDetailRow[]>;
}
