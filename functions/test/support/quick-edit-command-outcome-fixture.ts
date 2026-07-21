import { createQuickEditCommandOutcomeApplication } from "../reference/android-host/application/quickEditCommandOutcomeApplication";
import type {
  QuickEditAuthSession,
  QuickEditOperation,
  QuickEditTransactionView,
} from "../reference/android-host/application/ports/in/quickEditCommandOutcomeInputPort";
import type {
  QuickEditCommandGatewayResult,
  QuickEditSuccessfulCommandSnapshot,
} from "../reference/android-host/application/ports/out/quickEditCommandGatewayPort";

type ServerOutcome =
  | "success"
  | "already-processed"
  | "failure"
  | "failure-after-first-derived-write"
  | "conflict";

function cloneTransaction(
  transaction: QuickEditTransactionView | undefined,
): QuickEditTransactionView | undefined {
  return transaction === undefined ? undefined : { ...transaction };
}

function cloneSuccess(
  result: QuickEditSuccessfulCommandSnapshot,
): QuickEditSuccessfulCommandSnapshot {
  return {
    operation: result.operation,
    transaction: cloneTransaction(result.transaction),
    derivedTransactions: result.derivedTransactions.map((item) => ({ ...item })),
    notificationReceipts: result.notificationReceipts.map((receipt) => ({
      ...receipt,
    })),
  };
}

export function createQuickEditCommandOutcomeFixture(
  initialTransaction: QuickEditTransactionView,
  fixture: {
    readonly authSession: QuickEditAuthSession;
    readonly serverNow: string;
    readonly currentUnsavedForm?: Pick<
      QuickEditTransactionView,
      "merchant" | "amountInWon" | "categoryId" | "memo"
    >;
  },
) {
  let nextServerOutcome: ServerOutcome = "success";
  let serverTransaction = cloneTransaction(initialTransaction);
  let serverDerivedTransactions: readonly QuickEditTransactionView[] = [];
  let serverNotificationReceipts: readonly {
    requesterMemberId: string;
    requestedAt: string;
  }[] = [];
  const receipts = new Map<string, QuickEditSuccessfulCommandSnapshot>();

  const commit = (
    operation: QuickEditOperation,
  ): QuickEditSuccessfulCommandSnapshot => {
    const current = serverTransaction ?? initialTransaction;

    switch (operation.kind) {
      case "Update":
        serverTransaction = {
          ...current,
          ...operation.form,
          aggregateVersion: current.aggregateVersion + 1,
        };
        serverDerivedTransactions = [];
        break;
      case "Delete":
        serverTransaction = undefined;
        serverDerivedTransactions = [];
        break;
      case "Split":
        serverTransaction = undefined;
        serverDerivedTransactions = operation.items.map((item, index) => ({
          transactionId: `${current.transactionId}-split-${index + 1}`,
          ...item,
          aggregateVersion: current.aggregateVersion + 1,
        }));
        break;
      case "RequestHouseholdNotification":
        if (fixture.authSession.kind === "Authenticated") {
          serverNotificationReceipts = [
            ...serverNotificationReceipts,
            {
              requesterMemberId: fixture.authSession.actor.memberId,
              requestedAt: fixture.serverNow,
            },
          ];
        }
        break;
    }

    return {
      operation: operation.kind,
      transaction: cloneTransaction(serverTransaction),
      derivedTransactions: serverDerivedTransactions.map((item) => ({ ...item })),
      notificationReceipts: serverNotificationReceipts.map((receipt) => ({
        ...receipt,
      })),
    };
  };

  const application = createQuickEditCommandOutcomeApplication({
    initialTransaction,
    authSessions: { current: () => fixture.authSession },
    commands: {
      async execute(input): Promise<QuickEditCommandGatewayResult> {
        const existing = receipts.get(input.idempotencyKey);

        if (nextServerOutcome === "failure" ||
          nextServerOutcome === "failure-after-first-derived-write") {
          return { kind: "Failed", code: "SERVER_UNAVAILABLE" };
        }
        if (nextServerOutcome === "conflict") {
          return { kind: "Conflict", code: "VERSION_MISMATCH" };
        }
        if (existing !== undefined) {
          return { kind: "AlreadyProcessed", ...cloneSuccess(existing) };
        }

        const committed = commit(input.operation);
        receipts.set(input.idempotencyKey, cloneSuccess(committed));
        return {
          kind:
            nextServerOutcome === "already-processed"
              ? "AlreadyProcessed"
              : "Succeeded",
          ...cloneSuccess(committed),
        };
      },
    },
  });

  return {
    async execute(input: {
      readonly operation: QuickEditOperation;
      readonly expectedVersion: number;
      readonly idempotencyKey: string;
      readonly serverOutcome: ServerOutcome;
    }) {
      nextServerOutcome = input.serverOutcome;
      return application.execute({
        operation: input.operation,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      });
    },
    recreateActivity: () => application.recreateActivity(),
    state: () => application.state(),
  };
}
