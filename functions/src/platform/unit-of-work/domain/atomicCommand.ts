export interface AtomicRecord {
  readonly recordId: string;
  readonly value: string;
}

export interface AtomicCommandReceipt {
  readonly commandId: string;
  readonly payloadFingerprint: string;
  readonly result: string;
}

export interface AtomicOutboxEvent {
  readonly eventId: string;
  readonly type: "RecordChanged.v1";
}

export interface AtomicUnitOfWorkState {
  readonly records: readonly AtomicRecord[];
  readonly receipts: readonly AtomicCommandReceipt[];
  readonly outboxEvents: readonly AtomicOutboxEvent[];
}

export type AtomicCommandResult =
  | { readonly kind: "success"; readonly recordId: string }
  | {
      readonly kind: "retryable-failure";
      readonly code: "UNIT_OF_WORK_COMMIT_FAILED";
    }
  | {
      readonly kind: "conflict";
      readonly code: "IDEMPOTENCY_PAYLOAD_MISMATCH";
    };

export type AtomicCommandDecision =
  | {
      readonly kind: "return";
      readonly result: AtomicCommandResult;
    }
  | {
      readonly kind: "commit";
      readonly nextState: AtomicUnitOfWorkState;
      readonly result: AtomicCommandResult;
      readonly event: AtomicOutboxEvent;
    };

export function atomicPayloadFingerprint(input: {
  readonly recordId: string;
  readonly value: string;
}): string {
  return JSON.stringify([input.recordId, input.value]);
}

export function decideAtomicCommand(input: {
  readonly state: AtomicUnitOfWorkState;
  readonly commandId: string;
  readonly recordId: string;
  readonly value: string;
  readonly eventId: string;
}): AtomicCommandDecision {
  const payloadFingerprint = atomicPayloadFingerprint(input);
  const receipt = input.state.receipts.find(
    (candidate) => candidate.commandId === input.commandId,
  );
  if (receipt !== undefined) {
    return receipt.payloadFingerprint === payloadFingerprint
      ? {
          kind: "return",
          result: { kind: "success", recordId: receipt.result.slice("success:".length) },
        }
      : {
          kind: "return",
          result: {
            kind: "conflict",
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
          },
        };
  }

  const result = { kind: "success", recordId: input.recordId } as const;
  const event: AtomicOutboxEvent = {
    eventId: input.eventId,
    type: "RecordChanged.v1",
  };
  return {
    kind: "commit",
    nextState: {
      records: [
        ...input.state.records,
        { recordId: input.recordId, value: input.value },
      ],
      receipts: [
        ...input.state.receipts,
        {
          commandId: input.commandId,
          payloadFingerprint,
          result: `success:${input.recordId}`,
        },
      ],
      outboxEvents: [...input.state.outboxEvents, event],
    },
    result,
    event,
  };
}
