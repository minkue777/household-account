import type {
  ReportingCategoryActionGateway,
  ReportingCategoryDetailQueryPort,
} from "./ports/reportingCategoryActionGateway";
import type {
  ReportingCategoryAction,
  ReportingCategoryActionResult,
  ReportingCategoryDetailRow,
} from "../model/reportingCategoryAction";

export interface ReportingCategoryActionController {
  execute(
    action: ReportingCategoryAction,
  ): Promise<ReportingCategoryActionResult>;
  currentQueryRevision(): number;
}

export function createReportingCategoryActionController(input: {
  initialRows: readonly ReportingCategoryDetailRow[];
  gateway: ReportingCategoryActionGateway;
  detailQuery: ReportingCategoryDetailQueryPort;
}): ReportingCategoryActionController {
  let rows = [...input.initialRows];
  let queryRevision = 0;

  return {
    execute: async (action) => {
      const upstream = await input.gateway.execute(action);
      if (upstream.kind !== "success") {
        return { ...upstream, rows: [...rows], queryRevision };
      }

      rows = [...(await input.detailQuery.refresh())];
      queryRevision += 1;
      return { kind: "success", rows: [...rows], queryRevision };
    },
    currentQueryRevision: () => queryRevision,
  };
}
