import type {
  CapturedLineageCancellationClock,
  CapturedLineageCancellationStore,
} from "../ports/capturedLineageCancellationStore";
import type { CapturedLineageCancellationResult } from "../../domain/model/capturedLineageCancellation";

export interface CapturedLineageCancellationCommands {
  cancel(input: {
    actor: { householdId: string; memberId: string };
    cancellationKey: string;
    captureLineageId: string;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<CapturedLineageCancellationResult>;
}

export function createCapturedLineageCancellationCommands(input: {
  store: CapturedLineageCancellationStore;
  clock: CapturedLineageCancellationClock;
}): CapturedLineageCancellationCommands {
  return {
    cancel: async (command) => {
      const replay = await input.store.findReceipt(command.cancellationKey);
      if (replay !== undefined) return replay;

      const loaded = await input.store.load();
      if (loaded.kind !== "ready") return loaded;
      const state = loaded.value;
      const priorCancellation = state.cancelledLineages.find(
        (entry) => entry.captureLineageId === command.captureLineageId,
      );
      if (priorCancellation !== undefined) {
        return {
          kind: "AlreadyCancelled",
          captureLineageId: command.captureLineageId,
        };
      }

      const lineageTransactions = state.transactions.filter(
        (transaction) =>
          transaction.householdId === command.actor.householdId &&
          transaction.captureLineageId === command.captureLineageId,
      );
      const claim = state.claims.find(
        (candidate) =>
          candidate.captureLineageId === command.captureLineageId &&
          candidate.state === "active",
      );
      if (lineageTransactions.length === 0 || claim === undefined) {
        return { kind: "NotFound" };
      }

      const transactionVersionMismatch = lineageTransactions.some(
        (transaction) =>
          command.expectedVersions[transaction.transactionId] !==
          transaction.aggregateVersion,
      );
      const lineageVersionMismatch =
        command.expectedVersions[command.captureLineageId] !==
        lineageTransactions.length;
      if (transactionVersionMismatch || lineageVersionMismatch) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }

      const deletedTransactionIds = lineageTransactions.map(
        (transaction) => transaction.transactionId,
      );
      const result = {
        kind: "Cancelled" as const,
        captureLineageId: command.captureLineageId,
        deletedTransactionIds,
      };
      const nextState = {
        transactions: state.transactions
          .filter(
            (transaction) =>
              !deletedTransactionIds.includes(transaction.transactionId),
          )
          .map((transaction) => ({ ...transaction })),
        claims: state.claims.map((candidate) =>
          candidate.captureLineageId === command.captureLineageId
            ? {
                ...candidate,
                state: "cancelled" as const,
                cancelledAt: input.clock.now(),
              }
            : { ...candidate },
        ),
        cancelledLineages: [
          ...state.cancelledLineages.map((entry) => ({ ...entry })),
          {
            captureLineageId: command.captureLineageId,
            receiptId: command.cancellationKey,
          },
        ],
        events: [
          ...state.events.map((event) => ({
            ...event,
            deletedTransactionIds: [...event.deletedTransactionIds],
          })),
          {
            eventName: "CapturedLineageCancelled.v1" as const,
            deletedTransactionIds,
          },
        ],
      };
      const committed = await input.store.commit({
        cancellationKey: command.cancellationKey,
        state: nextState,
        result,
      });
      return committed.kind === "success" ? result : committed;
    },
  };
}
