import { createReportingCategoryActionController } from "../../src/read-side/reporting/application/reportingCategoryActionController";
import type {
  ReportingCategoryActionGateway,
  ReportingCategoryDetailQueryPort,
} from "../../src/read-side/reporting/application/ports/reportingCategoryActionGateway";
import type {
  ReportingCategoryAction,
  ReportingCategoryActionController,
  ReportingCategoryDetailRow,
  ReportingUpstreamActionResult,
} from "../../src/read-side/reporting/public";

export function createReportingCategoryActionFixtureSubject(fixture: {
  initialRows: readonly ReportingCategoryDetailRow[];
  upstreamResult: ReportingUpstreamActionResult;
  refreshedRows?: readonly ReportingCategoryDetailRow[];
}): ReportingCategoryActionController & {
  observedCommands(): readonly ReportingCategoryAction[];
} {
  const commands: ReportingCategoryAction[] = [];
  const gateway: ReportingCategoryActionGateway = {
    execute: async (action) => {
      commands.push(action);
      return fixture.upstreamResult;
    },
  };
  const detailQuery: ReportingCategoryDetailQueryPort = {
    refresh: async () => fixture.refreshedRows ?? fixture.initialRows,
  };
  const controller = createReportingCategoryActionController({
    initialRows: fixture.initialRows,
    gateway,
    detailQuery,
  });
  return {
    ...controller,
    observedCommands: () => [...commands],
  };
}
