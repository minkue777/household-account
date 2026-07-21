import { createBoundedReportingQuery } from "../../src/read-side/reporting/application/queries/boundedReportingQuery";
import type { BoundedLedgerSourcePort } from "../../src/read-side/reporting/application/ports/boundedLedgerSource";
import type {
  BoundedLedgerSourceResponse,
  BoundedReportingQuery,
} from "../../src/read-side/reporting/public";

export function createBoundedReportingFixtureSubject(seed: {
  responses: Readonly<
    Record<string, BoundedLedgerSourceResponse | Promise<BoundedLedgerSourceResponse>>
  >;
  maxRows: number;
  maxPages: number;
}): BoundedReportingQuery {
  const source: BoundedLedgerSourcePort = {
    load: async ({ identity }) => {
      const response = seed.responses[identity.queryKey];
      if (response === undefined) {
        return { kind: "contract-failure", code: "SOURCE_QUERY_NOT_CONFIGURED" };
      }
      return response;
    },
  };
  return createBoundedReportingQuery(source, {
    maxRows: seed.maxRows,
    maxPages: seed.maxPages,
  });
}
