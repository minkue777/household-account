import type {
  ReportingAuthoritativeStateQueryPort,
  ReportingOwnedActionGateway,
} from "./ports/reportingAuthoritativeOwner";
import type {
  ReportingAuthoritativeState,
  ReportingOwnedAction,
  ReportingOwnedActionResult,
} from "../model/reportingAuthoritativeAction";

export interface ReportingAuthoritativeActionController {
  execute(action: ReportingOwnedAction): Promise<ReportingOwnedActionResult>;
  currentState(): ReportingAuthoritativeState;
}

function copyState(
  state: ReportingAuthoritativeState,
): ReportingAuthoritativeState {
  return {
    transactions: state.transactions.map((transaction) => ({ ...transaction })),
    merchantRules: state.merchantRules.map((rule) => ({ ...rule })),
    queryRevision: state.queryRevision,
  };
}

export function createReportingAuthoritativeActionController(input: {
  initialState: ReportingAuthoritativeState;
  gateway: ReportingOwnedActionGateway;
  authoritativeQuery: ReportingAuthoritativeStateQueryPort;
}): ReportingAuthoritativeActionController {
  let state = copyState(input.initialState);

  return {
    execute: async (action) => {
      const upstream = await input.gateway.execute(action);
      if (upstream.kind !== "success") {
        return { ...upstream, state: copyState(state) };
      }

      const refreshed = await input.authoritativeQuery.refresh();
      state = {
        transactions: refreshed.transactions.map((transaction) => ({
          ...transaction,
        })),
        merchantRules: refreshed.merchantRules.map((rule) => ({ ...rule })),
        queryRevision: state.queryRevision + 1,
      };
      return {
        kind: "success",
        state: copyState(state),
        receipt: upstream.receipt,
        event: upstream.event,
      };
    },
    currentState: () => copyState(state),
  };
}
