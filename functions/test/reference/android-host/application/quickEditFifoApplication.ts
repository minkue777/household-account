import type {
  PersistedQuickEditQueueEntry,
  QuickEditFifoInputPort,
  QuickEditPresentationCheck,
  QuickEditQueueSnapshot,
  QuickEditSessionScope,
} from "./ports/in/quickEditFifoInputPort";

export interface QuickEditFifoApplicationOptions {
  readonly session: QuickEditSessionScope;
  readonly restoredEntries?: readonly PersistedQuickEditQueueEntry[];
  readonly presentationChecks?: Readonly<
    Record<string, QuickEditPresentationCheck>
  >;
}

const isSameSession = (
  entry: PersistedQuickEditQueueEntry,
  session: QuickEditSessionScope,
): boolean =>
  entry.sessionGeneration === session.sessionGeneration &&
  entry.householdId === session.householdId &&
  entry.memberId === session.memberId;

const bySequence = (
  left: PersistedQuickEditQueueEntry,
  right: PersistedQuickEditQueueEntry,
): number => left.sequence - right.sequence;

export function createQuickEditFifoApplication(
  options: QuickEditFifoApplicationOptions,
): QuickEditFifoInputPort {
  let persistedEntries = [...(options.restoredEntries ?? [])].sort(bySequence);
  let currentTransactionId: string | undefined;
  let pendingTransactionIds: string[] = [];
  const presentedTransactionIds: string[] = [];
  const skippedTransactionIds: string[] = [];
  let nextQueueWriteResult: "success" | "failure" = "success";

  const rememberOnce = (target: string[], transactionId: string): void => {
    if (!target.includes(transactionId)) target.push(transactionId);
  };

  const presentationCheck = (transactionId: string): QuickEditPresentationCheck =>
    options.presentationChecks?.[transactionId] ?? "active-and-authorized";

  const removePersisted = (transactionId: string): void => {
    persistedEntries = persistedEntries.filter(
      (entry) => entry.transactionId !== transactionId,
    );
  };

  const rebuildPresentationQueue = (): void => {
    const validEntries: PersistedQuickEditQueueEntry[] = [];

    for (const entry of [...persistedEntries].sort(bySequence)) {
      const valid =
        isSameSession(entry, options.session) &&
        presentationCheck(entry.transactionId) === "active-and-authorized";

      if (valid) {
        validEntries.push(entry);
      } else {
        rememberOnce(skippedTransactionIds, entry.transactionId);
      }
    }

    persistedEntries = validEntries;
    currentTransactionId = validEntries[0]?.transactionId;
    pendingTransactionIds = validEntries.slice(1).map(({ transactionId }) => transactionId);
    if (currentTransactionId !== undefined) {
      rememberOnce(presentedTransactionIds, currentTransactionId);
    }
  };

  return {
    async signalStoredTransaction(signal) {
      if (
        persistedEntries.some(
          (entry) =>
            isSameSession(entry, options.session) &&
            entry.transactionId === signal.transactionId,
        )
      ) {
        return { kind: "AlreadyQueued", transactionId: signal.transactionId };
      }

      if (nextQueueWriteResult === "failure") {
        nextQueueWriteResult = "success";
        return { kind: "StorageFailure", code: "QUEUE_WRITE_FAILED" };
      }

      const nextSequence =
        persistedEntries.reduce(
          (maximum, entry) => Math.max(maximum, entry.sequence),
          0,
        ) + 1;
      persistedEntries.push({
        ...options.session,
        transactionId: signal.transactionId,
        sequence: nextSequence,
        enqueuedAt: signal.savedAt,
      });
      persistedEntries.sort(bySequence);

      if (currentTransactionId === undefined) {
        currentTransactionId = signal.transactionId;
        rememberOnce(presentedTransactionIds, signal.transactionId);
        return { kind: "Opened", transactionId: signal.transactionId };
      }

      pendingTransactionIds.push(signal.transactionId);
      return { kind: "Queued", transactionId: signal.transactionId };
    },

    async finishCurrent(result) {
      if (currentTransactionId === undefined) return { kind: "QueueDrained" };

      if (result === "conflict" || result === "retryable-failure") {
        return { kind: "Retained", transactionId: currentTransactionId };
      }

      removePersisted(currentTransactionId);
      rebuildPresentationQueue();

      return currentTransactionId === undefined
        ? { kind: "QueueDrained" }
        : { kind: "Advanced", nextTransactionId: currentTransactionId };
    },

    async restartProcess() {
      currentTransactionId = undefined;
      pendingTransactionIds = [];
      rebuildPresentationQueue();
    },

    setNextQueueWriteResult(result) {
      nextQueueWriteResult = result;
    },

    state(): QuickEditQueueSnapshot {
      return {
        currentTransactionId,
        pendingTransactionIds: [...pendingTransactionIds],
        persistedEntries: persistedEntries.map((entry) => ({ ...entry })),
        presentedTransactionIds: [...presentedTransactionIds],
        skippedTransactionIds: [...skippedTransactionIds],
      };
    },

    securityEvidence() {
      return {
        storageProtection: "android-keystore-backed-encryption",
        keyExportable: false,
        backupEligible: false,
        persistedFieldNames: [
          "sessionGeneration",
          "householdId",
          "memberId",
          "transactionId",
          "sequence",
          "enqueuedAt",
        ],
        containsDisplaySnapshotPlaintext: false,
      };
    },
  };
}
