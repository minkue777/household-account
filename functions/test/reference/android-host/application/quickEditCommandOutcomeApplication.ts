import type {
  QuickEditCommandOutcomeInputPort,
  QuickEditCommandResult,
  QuickEditCommandState,
  QuickEditOperation,
  QuickEditTransactionView,
} from "./ports/in/quickEditCommandOutcomeInputPort";
import type {
  QuickEditAuthSessionPort,
  QuickEditCommandGatewayPort,
  QuickEditSuccessfulCommandSnapshot,
} from "./ports/out/quickEditCommandGatewayPort";

const successMessages: Readonly<Record<QuickEditOperation["kind"], string>> = {
  Update: "저장되었습니다",
  Delete: "삭제되었습니다",
  Split: "분할되었습니다",
  RequestHouseholdNotification: "알림을 보냈습니다",
};

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

function isPositiveWonAmount(amountInWon: number): boolean {
  return Number.isSafeInteger(amountInWon) && amountInWon > 0;
}

function normalizeOperation(operation: QuickEditOperation): QuickEditOperation {
  switch (operation.kind) {
    case "Update":
      return { kind: "Update", form: { ...operation.form } };
    case "Delete":
      return {
        kind: "Delete",
        confirmedMerchant: operation.confirmedMerchant,
        confirmedAmountInWon: operation.confirmedAmountInWon,
      };
    case "Split":
      return {
        kind: "Split",
        items: operation.items.map((item) => ({ ...item })),
      };
    case "RequestHouseholdNotification":
      return { kind: "RequestHouseholdNotification" };
  }
}

function validationFailure(
  operation: QuickEditOperation,
  transaction: QuickEditTransactionView | undefined,
  authSessions: QuickEditAuthSessionPort,
): QuickEditCommandResult | undefined {
  switch (operation.kind) {
    case "Update":
      return isPositiveWonAmount(operation.form.amountInWon)
        ? undefined
        : { kind: "ValidationFailed", code: "INVALID_AMOUNT" };
    case "Delete":
      return transaction !== undefined &&
        operation.confirmedMerchant === transaction.merchant &&
        operation.confirmedAmountInWon === transaction.amountInWon
        ? undefined
        : {
            kind: "ValidationFailed",
            code: "DELETE_CONFIRMATION_MISMATCH",
          };
    case "Split": {
      if (transaction === undefined || operation.items.length < 2) {
        return { kind: "ValidationFailed", code: "INVALID_SPLIT" };
      }
      if (!operation.items.every(({ amountInWon }) => isPositiveWonAmount(amountInWon))) {
        return { kind: "ValidationFailed", code: "INVALID_SPLIT" };
      }
      const total = operation.items.reduce(
        (sum, { amountInWon }) => sum + amountInWon,
        0,
      );
      return Number.isSafeInteger(total) && total === transaction.amountInWon
        ? undefined
        : { kind: "ValidationFailed", code: "INVALID_SPLIT" };
    }
    case "RequestHouseholdNotification": {
      const session = authSessions.current();
      return session.kind === "Authenticated" &&
        session.actor.principalRef.trim() !== "" &&
        session.actor.householdId.trim() !== "" &&
        session.actor.memberId.trim() !== ""
        ? undefined
        : { kind: "ValidationFailed", code: "REQUESTER_REQUIRED" };
    }
  }
}

function snapshot(state: QuickEditCommandState): QuickEditCommandState {
  return {
    transaction: cloneTransaction(state.transaction),
    derivedTransactions: state.derivedTransactions.map((item) => ({ ...item })),
    screen: state.screen,
    successToasts: [...state.successToasts],
    completionEvents: [...state.completionEvents],
    notificationReceipts: state.notificationReceipts.map((receipt) => ({
      ...receipt,
    })),
  };
}

export function createQuickEditCommandOutcomeApplication(dependencies: {
  readonly initialTransaction: QuickEditTransactionView;
  readonly authSessions: QuickEditAuthSessionPort;
  readonly commands: QuickEditCommandGatewayPort;
}): QuickEditCommandOutcomeInputPort {
  let state: QuickEditCommandState = {
    transaction: cloneTransaction(dependencies.initialTransaction),
    derivedTransactions: [],
    screen: "Open",
    successToasts: [],
    completionEvents: [],
    notificationReceipts: [],
  };
  const completedIdempotencyKeys = new Set<string>();

  const applySuccessfulSnapshot = (
    idempotencyKey: string,
    result: QuickEditSuccessfulCommandSnapshot,
  ): void => {
    const canonical = cloneSuccess(result);
    const firstPresentation = !completedIdempotencyKeys.has(idempotencyKey);

    state = {
      transaction: canonical.transaction,
      derivedTransactions: canonical.derivedTransactions,
      screen: "Closed",
      successToasts: firstPresentation
        ? [...state.successToasts, successMessages[canonical.operation]]
        : state.successToasts,
      completionEvents: firstPresentation
        ? [...state.completionEvents, canonical.operation]
        : state.completionEvents,
      notificationReceipts: canonical.notificationReceipts,
    };
    completedIdempotencyKeys.add(idempotencyKey);
  };

  return {
    async execute(input) {
      const operation = normalizeOperation(input.operation);
      const replaysCompletedCommand = completedIdempotencyKeys.has(
        input.idempotencyKey,
      );

      if (!replaysCompletedCommand) {
        const invalid = validationFailure(
          operation,
          state.transaction,
          dependencies.authSessions,
        );
        if (invalid !== undefined) return invalid;
        if (state.transaction === undefined) {
          return { kind: "Conflict", code: "VERSION_MISMATCH" };
        }
      }

      const result = await dependencies.commands.execute({
        transactionId: dependencies.initialTransaction.transactionId,
        operation,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      });

      if (result.kind === "Failed" || result.kind === "Conflict") {
        return result;
      }

      applySuccessfulSnapshot(input.idempotencyKey, result);
      return { kind: "Succeeded", operation: result.operation };
    },

    recreateActivity() {
      // Activity recreation must retain the submitted command receipt and UI effects.
    },

    state: () => snapshot(state),
  };
}
