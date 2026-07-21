import type {
  BusinessAccessResult,
  HouseholdLifecycleCommandResult,
  HouseholdLifecycleInputPort,
  RequestHouseholdDeletionCommand,
  RequestPermanentHouseholdPurgeCommand,
  RestoreDeletedHouseholdCommand,
  VerifiedAdministrativeActor,
} from "./ports/in/householdLifecycleInputPort";
import type {
  HouseholdLifecycleClockPort,
  HouseholdLifecycleHashPort,
  HouseholdLifecycleIdentityPort,
  HouseholdLifecycleUnitOfWorkPort,
} from "./ports/out/householdLifecyclePorts";
import type {
  HouseholdLifecycleReceipt,
  StoredHouseholdLifecycleResult,
} from "../domain/model/householdLifecycle";
import {
  hasHouseholdLifecycleCapability,
  householdLifecyclePayloadFingerprint,
  toHouseholdLifecycleView,
} from "../domain/policies/householdLifecyclePolicy";

export interface HouseholdLifecycleApplicationDependencies {
  unitOfWork: HouseholdLifecycleUnitOfWorkPort;
  clock: HouseholdLifecycleClockPort;
  identities: HouseholdLifecycleIdentityPort;
  hash: HouseholdLifecycleHashPort;
}

function replayOrConflict(
  receipt: HouseholdLifecycleReceipt | undefined,
  payloadFingerprint: string,
): HouseholdLifecycleCommandResult | undefined {
  if (receipt === undefined) return undefined;
  return receipt.payloadFingerprint === payloadFingerprint
    ? receipt.result
    : { kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" };
}

class DefaultHouseholdLifecycleApplication
  implements HouseholdLifecycleInputPort
{
  constructor(
    private readonly dependencies: HouseholdLifecycleApplicationDependencies,
  ) {}

  async requestHouseholdDeletion(
    actor: VerifiedAdministrativeActor,
    input: RequestHouseholdDeletionCommand,
  ): Promise<HouseholdLifecycleCommandResult> {
    if (!hasHouseholdLifecycleCapability(actor.capabilities, "household.delete")) {
      return { kind: "forbidden", code: "HOUSEHOLD_DELETE_REQUIRED" };
    }
    if (input.reason.trim().length === 0) {
      return { kind: "conflict", code: "DELETION_REASON_REQUIRED" };
    }
    const payloadFingerprint = householdLifecyclePayloadFingerprint({
      operation: "delete",
      householdId: input.householdId,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    });

    return this.dependencies.unitOfWork.transact<HouseholdLifecycleCommandResult>(
      (state) => {
        if (state.household.householdId !== input.householdId) {
          return {
            state,
            value: { kind: "conflict", code: "HOUSEHOLD_SCOPE_MISMATCH" },
          };
        }
        const replay = replayOrConflict(
          state.receipts.find(
            (receipt) => receipt.idempotencyKey === input.idempotencyKey,
          ),
          payloadFingerprint,
        );
        if (replay !== undefined) return { state, value: replay };

        if (state.household.lifecycleState === "deleted") {
          const result: StoredHouseholdLifecycleResult = {
            kind: "already-processed",
            household: toHouseholdLifecycleView(state.household),
          };
          return {
            state: {
              ...state,
              receipts: [
                ...state.receipts,
                { idempotencyKey: input.idempotencyKey, payloadFingerprint, result },
              ],
            },
            value: result,
          };
        }
        if (state.household.lifecycleState !== "active") {
          return {
            state,
            value: { kind: "conflict", code: "DELETION_ALREADY_RUNNING" },
          };
        }
        if (state.household.aggregateVersion !== input.expectedVersion) {
          return {
            state,
            value: {
              kind: "conflict",
              code: "VERSION_MISMATCH",
              currentVersion: state.household.aggregateVersion,
            },
          };
        }

        const deletedAt = this.dependencies.clock.now();
        const deletedByHash = this.dependencies.hash.hashSensitiveReference(
          actor.principalRef,
        );
        const household = {
          ...state.household,
          lifecycleState: "deleted" as const,
          aggregateVersion: state.household.aggregateVersion + 1,
          deletedAt,
          deletedByHash,
        };
        const result: StoredHouseholdLifecycleResult = {
          kind: "success",
          household: toHouseholdLifecycleView(household),
        };
        return {
          state: {
            ...state,
            household,
            receipts: [
              ...state.receipts,
              { idempotencyKey: input.idempotencyKey, payloadFingerprint, result },
            ],
            events: [
              ...state.events,
              {
                eventType: "HouseholdDeleted.v1",
                householdId: input.householdId,
                deletedAt,
                deletedByHash,
              },
            ],
          },
          value: result,
        };
      },
    );
  }

  async restoreDeletedHousehold(
    actor: VerifiedAdministrativeActor,
    input: RestoreDeletedHouseholdCommand,
  ): Promise<HouseholdLifecycleCommandResult> {
    if (!hasHouseholdLifecycleCapability(actor.capabilities, "household.restore")) {
      return { kind: "forbidden", code: "HOUSEHOLD_RESTORE_REQUIRED" };
    }
    if (input.reason.trim().length === 0) {
      return { kind: "conflict", code: "RESTORE_REASON_REQUIRED" };
    }
    const payloadFingerprint = householdLifecyclePayloadFingerprint({
      operation: "restore",
      householdId: input.householdId,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    });

    return this.dependencies.unitOfWork.transact<HouseholdLifecycleCommandResult>(
      (state) => {
        if (state.household.householdId !== input.householdId) {
          return {
            state,
            value: { kind: "conflict", code: "HOUSEHOLD_SCOPE_MISMATCH" },
          };
        }
        const replay = replayOrConflict(
          state.receipts.find(
            (receipt) => receipt.idempotencyKey === input.idempotencyKey,
          ),
          payloadFingerprint,
        );
        if (replay !== undefined) return { state, value: replay };

        if (state.household.lifecycleState === "active") {
          const result: StoredHouseholdLifecycleResult = {
            kind: "already-processed",
            household: toHouseholdLifecycleView(state.household),
          };
          return {
            state: {
              ...state,
              receipts: [
                ...state.receipts,
                { idempotencyKey: input.idempotencyKey, payloadFingerprint, result },
              ],
            },
            value: result,
          };
        }
        if (state.household.lifecycleState !== "deleted") {
          return {
            state,
            value: { kind: "conflict", code: "PURGE_ALREADY_STARTED" },
          };
        }
        if (
          state.purgeProcess !== undefined &&
          state.purgeProcess.status !== "completed"
        ) {
          return {
            state,
            value: { kind: "conflict", code: "PURGE_ALREADY_STARTED" },
          };
        }
        if (state.household.aggregateVersion !== input.expectedVersion) {
          return {
            state,
            value: {
              kind: "conflict",
              code: "VERSION_MISMATCH",
              currentVersion: state.household.aggregateVersion,
            },
          };
        }

        const restoredAt = this.dependencies.clock.now();
        const restoredByHash = this.dependencies.hash.hashSensitiveReference(
          actor.principalRef,
        );
        const { deletedAt: _deletedAt, deletedByHash: _deletedByHash, ...base } =
          state.household;
        const household = {
          ...base,
          lifecycleState: "active" as const,
          aggregateVersion: state.household.aggregateVersion + 1,
        };
        const result: StoredHouseholdLifecycleResult = {
          kind: "success",
          household: toHouseholdLifecycleView(household),
        };
        return {
          state: {
            ...state,
            household,
            receipts: [
              ...state.receipts,
              { idempotencyKey: input.idempotencyKey, payloadFingerprint, result },
            ],
            events: [
              ...state.events,
              {
                eventType: "HouseholdRestored.v1",
                householdId: input.householdId,
                restoredAt,
                restoredByHash,
              },
            ],
          },
          value: result,
        };
      },
    );
  }

  async requestPermanentHouseholdPurge(
    actor: VerifiedAdministrativeActor,
    input: RequestPermanentHouseholdPurgeCommand,
  ): Promise<HouseholdLifecycleCommandResult> {
    if (
      !hasHouseholdLifecycleCapability(
        actor.capabilities,
        "household.purge.permanent",
      )
    ) {
      return { kind: "forbidden", code: "PERMANENT_PURGE_REQUIRED" };
    }
    const confirmation = input.confirmation.trim();
    if (confirmation.length === 0) {
      return { kind: "conflict", code: "PURGE_CONFIRMATION_REQUIRED" };
    }
    const payloadFingerprint = householdLifecyclePayloadFingerprint({
      operation: "request-permanent-purge",
      householdId: input.householdId,
      expectedVersion: input.expectedVersion,
      confirmation,
    });

    return this.dependencies.unitOfWork.transact<HouseholdLifecycleCommandResult>(
      (state) => {
        if (state.household.householdId !== input.householdId) {
          return {
            state,
            value: { kind: "conflict", code: "HOUSEHOLD_SCOPE_MISMATCH" },
          };
        }
        const replay = replayOrConflict(
          state.receipts.find(
            (receipt) => receipt.idempotencyKey === input.idempotencyKey,
          ),
          payloadFingerprint,
        );
        if (replay !== undefined) return { state, value: replay };

        if (state.household.lifecycleState !== "deleted") {
          return {
            state,
            value: { kind: "conflict", code: "HOUSEHOLD_MUST_BE_DELETED" },
          };
        }
        if (state.household.aggregateVersion !== input.expectedVersion) {
          return {
            state,
            value: {
              kind: "conflict",
              code: "VERSION_MISMATCH",
              currentVersion: state.household.aggregateVersion,
            },
          };
        }

        const processId = this.dependencies.identities.nextPurgeProcessId(
          input.idempotencyKey,
        );
        const confirmationRefHash =
          this.dependencies.hash.hashSensitiveReference(confirmation);
        const household = {
          ...state.household,
          lifecycleState: "purging" as const,
          aggregateVersion: state.household.aggregateVersion + 1,
        };
        const result: StoredHouseholdLifecycleResult = {
          kind: "success",
          household: toHouseholdLifecycleView(household),
          processId,
        };
        return {
          state: {
            ...state,
            household,
            purgeProcess: {
              processId,
              status: "requested",
              confirmationRefHash,
            },
            receipts: [
              ...state.receipts,
              { idempotencyKey: input.idempotencyKey, payloadFingerprint, result },
            ],
            events: [
              ...state.events,
              {
                eventType: "HouseholdPermanentPurgeRequested.v1",
                householdId: input.householdId,
                processId,
                confirmationRefHash,
              },
            ],
          },
          value: result,
        };
      },
    );
  }

  async authorizeBusinessAccess(
    householdId: string,
  ): Promise<BusinessAccessResult> {
    const state = await this.dependencies.unitOfWork.read();
    return state.household.householdId === householdId &&
      state.household.lifecycleState === "active"
      ? { kind: "allowed", householdId }
      : { kind: "conflict", code: "HOUSEHOLD_NOT_ACTIVE" };
  }
}

export function createHouseholdLifecycleApplication(
  dependencies: HouseholdLifecycleApplicationDependencies,
): HouseholdLifecycleInputPort {
  return new DefaultHouseholdLifecycleApplication(dependencies);
}
