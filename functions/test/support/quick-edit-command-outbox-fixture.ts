export interface QuickEditOutboxScopeFixture {
  readonly sessionGeneration: string;
  readonly householdId: string;
  readonly memberId: string;
}

export interface QuickEditOutboxEnvelopeFixture {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

type DeliveryResult =
  | "success"
  | "already-processed"
  | "retryable"
  | "conflict"
  | "rejected"
  | "contract-failure";

interface StoredEntry {
  readonly scope: QuickEditOutboxScopeFixture;
  readonly queuedAt: string;
  readonly envelope: QuickEditOutboxEnvelopeFixture;
  readonly state: "pending" | "needs-attention";
  readonly failureNotificationPending: boolean;
}

const sameScope = (
  left: QuickEditOutboxScopeFixture,
  right: QuickEditOutboxScopeFixture,
): boolean =>
  left.sessionGeneration === right.sessionGeneration &&
  left.householdId === right.householdId &&
  left.memberId === right.memberId;

const retryWindowMillis = 72 * 60 * 60 * 1_000;

export function createQuickEditCommandOutboxFixture(
  initialScope: QuickEditOutboxScopeFixture,
) {
  let scope = { ...initialScope };
  let entries: StoredEntry[] = [];
  let screen: "open" | "closed" = "open";
  let nextCommit: "success" | "failure" = "success";
  let nextReservation: "success" | "failure" = "success";
  let unrecoverableLossNotificationPending = false;
  const attempts: QuickEditOutboxEnvelopeFixture[] = [];

  return {
    setNextCommit(result: "success" | "failure") {
      nextCommit = result;
    },

    setNextReservation(result: "success" | "failure") {
      nextReservation = result;
    },

    async submit(input: {
      readonly queuedAt: string;
      readonly envelope: QuickEditOutboxEnvelopeFixture;
    }) {
      if (nextCommit === "failure") {
        nextCommit = "success";
        return { kind: "rejected", code: "OUTBOX_WRITE_FAILED" } as const;
      }

      if (!entries.some(
        (entry) => entry.envelope.commandId === input.envelope.commandId,
      )) {
        entries.push({
          scope: { ...scope },
          queuedAt: input.queuedAt,
          envelope: {
            ...input.envelope,
            payload: { ...input.envelope.payload },
          },
          state: "pending",
          failureNotificationPending: false,
        });
      }
      if (nextReservation === "failure") {
        nextReservation = "success";
        return {
          kind: "rejected",
          code: "DELIVERY_RESERVATION_FAILED",
        } as const;
      }
      screen = "closed";
      return { kind: "accepted" } as const;
    },

    restartProcess() {
      attempts.splice(0, attempts.length);
    },

    corruptEncryptedSnapshot(_kind: "ciphertext" | "codec") {
      // payload는 복구를 시도해 노출하지 않고 폐기하며, 별도 비민감 신호만 남긴다.
      entries = [];
      unrecoverableLossNotificationPending = true;
    },

    async deliver(input: {
      readonly now: string;
      resultFor(commandId: string): DeliveryResult;
    }) {
      const now = Date.parse(input.now);
      for (const candidate of [...entries]) {
        if (candidate.state !== "pending" || !sameScope(candidate.scope, scope)) {
          continue;
        }
        if (now - Date.parse(candidate.queuedAt) >= retryWindowMillis) {
          entries = entries.map((entry) =>
            entry.envelope.commandId === candidate.envelope.commandId
              ? {
                  ...entry,
                  state: "needs-attention",
                  failureNotificationPending: true,
                }
              : entry,
          );
          continue;
        }

        attempts.push(candidate.envelope);
        const result = input.resultFor(candidate.envelope.commandId);
        if (result === "retryable") break;
        if (result === "success" || result === "already-processed") {
          entries = entries.filter(
            (entry) => entry.envelope.commandId !== candidate.envelope.commandId,
          );
          continue;
        }
        entries = entries.map((entry) =>
          entry.envelope.commandId === candidate.envelope.commandId
            ? {
                ...entry,
                state: "needs-attention",
                failureNotificationPending: true,
              }
            : entry,
        );
      }
    },

    deliverFailureNotifications(delivered: boolean) {
      const pending = entries.filter((entry) => entry.failureNotificationPending);
      const notificationIds = [
        ...pending.map((entry) => entry.envelope.commandId),
        ...(unrecoverableLossNotificationPending ? ["outbox-storage-loss"] : []),
      ];
      if (delivered) {
        const deliveredIds = new Set(pending.map((entry) => entry.envelope.commandId));
        entries = entries.filter((entry) => !deliveredIds.has(entry.envelope.commandId));
        unrecoverableLossNotificationPending = false;
      }
      return notificationIds;
    },

    transitionSession(nextScope: QuickEditOutboxScopeFixture) {
      entries = [];
      unrecoverableLossNotificationPending = false;
      scope = { ...nextScope };
    },

    state() {
      return {
        screen,
        entries: entries.map((entry) => ({
          ...entry,
          scope: { ...entry.scope },
          envelope: {
            ...entry.envelope,
            payload: { ...entry.envelope.payload },
          },
        })),
        attempts: attempts.map((envelope) => ({
          ...envelope,
          payload: { ...envelope.payload },
        })),
        failureNotificationRetryRequired:
          unrecoverableLossNotificationPending ||
          entries.some((entry) => entry.failureNotificationPending),
        unrecoverableLossNotificationPending,
        atRest: {
          encryption: "AES-256-GCM" as const,
          keyLocation: "AndroidKeystore" as const,
          plaintextPayloadPresent: false as const,
          backupEligible: false as const,
        },
      };
    },
  };
}
