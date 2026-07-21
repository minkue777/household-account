import { createReportingAuthoritativeActionController } from "../../src/read-side/reporting/application/reportingAuthoritativeActionController";
import type {
  ReportingAuthoritativeStateQueryPort,
  ReportingOwnedActionGateway,
} from "../../src/read-side/reporting/application/ports/reportingAuthoritativeOwner";
import type {
  ReportingAuthoritativeState,
  ReportingMerchantRuleView,
  ReportingOwnedAction,
  ReportingTransactionView,
  ReportingUpstreamEvent,
  ReportingUpstreamReceipt,
} from "../../src/read-side/reporting/model/reportingAuthoritativeAction";

export function createReportingAuthoritativeActionFixtureSubject(fixture: {
  initialState: ReportingAuthoritativeState;
  forcedOutcome?: "conflict" | "failure";
}) {
  let transactions: ReportingTransactionView[] =
    fixture.initialState.transactions.map((transaction) => ({ ...transaction }));
  let merchantRules: ReportingMerchantRuleView[] =
    fixture.initialState.merchantRules.map((rule) => ({ ...rule }));
  const receipts: ReportingUpstreamReceipt[] = [];
  const events: ReportingUpstreamEvent[] = [];

  function forcedResult(action: ReportingOwnedAction) {
    if (fixture.forcedOutcome === undefined) return undefined;
    if (fixture.forcedOutcome === "failure") {
      return {
        kind: "failure" as const,
        code:
          action.kind === "save-merchant-rule"
            ? "PAYMENT_CONFIGURATION_UNAVAILABLE"
            : "LEDGER_UNAVAILABLE",
      };
    }
    return {
      kind: "conflict" as const,
      code:
        action.kind === "save-merchant-rule"
          ? "MERCHANT_RULE_CONFLICT"
          : "TRANSACTION_VERSION_MISMATCH",
    };
  }

  const gateway: ReportingOwnedActionGateway = {
    execute: async (action) => {
      const forced = forcedResult(action);
      if (forced !== undefined) return forced;

      let receipt: ReportingUpstreamReceipt;
      let event: ReportingUpstreamEvent;
      if (action.kind === "save-merchant-rule") {
        const existingIndex = merchantRules.findIndex(
          (rule) => rule.merchantPattern === action.merchantPattern,
        );
        const existing = merchantRules[existingIndex];
        const ruleId = existing?.ruleId ?? `merchant-rule:${action.commandId}`;
        const aggregateVersion = (existing?.aggregateVersion ?? 0) + 1;
        const changed: ReportingMerchantRuleView = {
          ruleId,
          merchantPattern: action.merchantPattern,
          categoryId: action.categoryId,
          aggregateVersion,
        };
        if (existingIndex === -1) merchantRules.push(changed);
        else merchantRules[existingIndex] = changed;
        receipt = {
          receiptId: `receipt:${action.commandId}`,
          commandId: action.commandId,
          ownerModule: "payment-configuration",
          aggregateId: ruleId,
          resultingVersion: aggregateVersion,
        };
        event = {
          eventType: "MerchantRuleChanged.v1",
          aggregateId: ruleId,
          aggregateVersion,
        };
      } else {
        const index = transactions.findIndex(
          (candidate) => candidate.transactionId === action.transactionId,
        );
        const current = transactions[index];
        if (
          current === undefined ||
          current.aggregateVersion !== action.expectedVersion
        ) {
          return {
            kind: "conflict",
            code: "TRANSACTION_VERSION_MISMATCH",
          };
        }
        const aggregateVersion = current.aggregateVersion + 1;
        transactions[index] =
          action.kind === "update-transaction"
            ? {
                ...current,
                merchant: action.merchant,
                amountInWon: action.amountInWon,
                aggregateVersion,
              }
            : { ...current, lifecycle: "deleted", aggregateVersion };
        receipt = {
          receiptId: `receipt:${action.commandId}`,
          commandId: action.commandId,
          ownerModule: "ledger",
          aggregateId: action.transactionId,
          resultingVersion: aggregateVersion,
        };
        event = {
          eventType:
            action.kind === "update-transaction"
              ? "TransactionChanged.v1"
              : "TransactionDeleted.v1",
          aggregateId: action.transactionId,
          aggregateVersion,
        };
      }

      receipts.push(receipt);
      events.push(event);
      return { kind: "success", receipt, event };
    },
  };

  const authoritativeQuery: ReportingAuthoritativeStateQueryPort = {
    refresh: async () => ({
      transactions: transactions
        .filter((transaction) => transaction.lifecycle === "active")
        .map((transaction) => ({ ...transaction })),
      merchantRules: merchantRules.map((rule) => ({ ...rule })),
    }),
  };
  const controller = createReportingAuthoritativeActionController({
    initialState: fixture.initialState,
    gateway,
    authoritativeQuery,
  });
  return {
    ...controller,
    upstreamReceipts: () => receipts.map((receipt) => ({ ...receipt })),
    upstreamEvents: () => events.map((event) => ({ ...event })),
  };
}
