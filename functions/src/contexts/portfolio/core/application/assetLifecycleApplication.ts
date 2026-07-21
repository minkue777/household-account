import type {
  ApplyPermanentAssetPurgePageCommand,
  AssetLifecycleCommandResult,
  AssetLifecycleDecision,
  AssetLifecycleAuditRecord,
  AssetLifecycleEvent,
  AssetLifecycleReceipt,
  AssetLifecycleRecord,
  AssetPurgeParticipant,
  DeleteAssetCommand,
  RequestPermanentAssetPurgeCommand,
  RestoreDeletedAssetCommand,
} from "../domain/model/assetLifecycle";
import {
  initialPurgeParticipants,
  lifecyclePayloadFingerprint,
  nextLifecycleAsset,
  validateRequiredText,
} from "../domain/model/assetLifecycle";
import type {
  AssetLifecycleInputPort,
  DeletedAssetListResult,
  VisibleAssetResult,
} from "./ports/in/assetLifecycleInputPort";
import type {
  AssetLifecycleClockPort,
  AssetLifecycleHashPort,
  AssetLifecycleIdPort,
  AssetRestorationParticipantPort,
  AssetLifecycleUnitOfWorkPort,
} from "./ports/out/assetLifecyclePorts";

export interface AssetLifecycleApplicationDependencies {
  readonly unitOfWork: AssetLifecycleUnitOfWorkPort;
  readonly clock: AssetLifecycleClockPort;
  readonly ids: AssetLifecycleIdPort;
  readonly hash: AssetLifecycleHashPort;
  readonly restorationParticipant: AssetRestorationParticipantPort;
}

function hasCapability(
  capabilities: readonly string[],
  capability: string,
): boolean {
  return capabilities.includes(capability);
}

function replayDecision(
  record: AssetLifecycleRecord,
  idempotencyKey: string,
  payloadFingerprint: string,
): Extract<AssetLifecycleDecision, { readonly kind: "return" }> | undefined {
  const previous = record.commandReceipts[idempotencyKey];
  if (previous === undefined) return undefined;
  return previous.payloadFingerprint === payloadFingerprint
    ? { kind: "return", result: previous.result }
    : {
        kind: "return",
        result: {
          kind: "conflict",
          code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        },
      };
}

function commitDecision(input: {
  readonly current: AssetLifecycleRecord;
  readonly next: AssetLifecycleRecord;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly receipt: AssetLifecycleReceipt;
  readonly events?: readonly AssetLifecycleEvent[];
  readonly auditRecords?: readonly AssetLifecycleAuditRecord[];
  readonly result: AssetLifecycleCommandResult;
}): AssetLifecycleDecision {
  return {
    kind: "commit",
    nextRecord: {
      ...input.next,
      commandReceipts: {
        ...input.current.commandReceipts,
        [input.idempotencyKey]: {
          payloadFingerprint: input.payloadFingerprint,
          result: input.result,
        },
      },
    },
    receipt: input.receipt,
    events: input.events ?? [],
    ...(input.auditRecords === undefined
      ? {}
      : { auditRecords: input.auditRecords }),
    result: input.result,
  };
}

function missingAsset(): Extract<
  AssetLifecycleDecision,
  { readonly kind: "return" }
> {
  return {
    kind: "return",
    result: { kind: "not-found", code: "ASSET_NOT_FOUND" },
  };
}

function scopeMismatch(): Extract<
  AssetLifecycleDecision,
  { readonly kind: "return" }
> {
  return {
    kind: "return",
    result: { kind: "forbidden", code: "HOUSEHOLD_SCOPE_MISMATCH" },
  };
}

class DefaultAssetLifecycleApplication implements AssetLifecycleInputPort {
  constructor(private readonly dependencies: AssetLifecycleApplicationDependencies) {}

  async deleteAsset(
    command: DeleteAssetCommand,
  ): Promise<AssetLifecycleCommandResult> {
    if (!hasCapability(command.actor.capabilities, "portfolio.asset.write")) {
      return { kind: "forbidden", code: "ASSET_WRITE_FORBIDDEN" };
    }
    const deletedAt = this.dependencies.clock.now();
    const fingerprint = this.dependencies.hash.hash(
      lifecyclePayloadFingerprint({
        actorId: command.actor.actorId,
        householdId: command.actor.householdId,
        assetId: command.assetId,
        expectedVersion: command.expectedVersion,
      }),
    );
    return this.dependencies.unitOfWork.transact(command.assetId, (record) => {
      const replay = replayDecision(record, command.idempotencyKey, fingerprint);
      if (replay !== undefined) return replay;
      const asset = record.asset;
      if (asset === undefined) return missingAsset();
      if (asset.householdId !== command.actor.householdId) return scopeMismatch();
      if (asset.aggregateVersion !== command.expectedVersion) {
        return {
          kind: "return",
          result: { kind: "conflict", code: "ASSET_VERSION_MISMATCH" },
        };
      }
      if (asset.lifecycleState !== "active") {
        return {
          kind: "return",
          result: { kind: "conflict", code: "ASSET_NOT_ACTIVE" },
        };
      }

      const nextAsset = nextLifecycleAsset(asset, "deleted", deletedAt);
      const receipt: AssetLifecycleReceipt = {
        commandId: command.commandId,
        assetId: asset.assetId,
        operation: "delete",
        resultingVersion: nextAsset.aggregateVersion,
      };
      const result: AssetLifecycleCommandResult = {
        kind: "success",
        asset: nextAsset,
        receipt,
      };
      return commitDecision({
        current: record,
        next: { ...record, asset: nextAsset },
        idempotencyKey: command.idempotencyKey,
        payloadFingerprint: fingerprint,
        receipt,
        events: [
          {
            eventType: "AssetLifecycleChanged.v1",
            assetId: asset.assetId,
            before: "active",
            after: "deleted",
            aggregateVersion: nextAsset.aggregateVersion,
          },
        ],
        result,
      });
    });
  }

  async restoreDeletedAsset(
    command: RestoreDeletedAssetCommand,
  ): Promise<AssetLifecycleCommandResult> {
    if (
      !hasCapability(
        command.actor.capabilities,
        "portfolio.asset.restore.deleted",
      )
    ) {
      return { kind: "forbidden", code: "ASSET_RESTORE_FORBIDDEN" };
    }
    const reason = validateRequiredText(
      command.auditReason,
      "ASSET_RESTORE_AUDIT_REASON_REQUIRED",
    );
    if (reason.kind === "invalid") {
      return { kind: "validation-error", code: reason.code };
    }
    const fingerprint = this.dependencies.hash.hash(
      lifecyclePayloadFingerprint({
        actorId: command.actor.actorId,
        householdId: command.actor.householdId,
        assetId: command.assetId,
        expectedVersion: command.expectedVersion,
        restoredOn: command.restoredOn,
        auditReason: reason.value,
      }),
    );
    return this.dependencies.unitOfWork.transactRestoration(
      command.assetId,
      (snapshot) => {
        const record = snapshot.lifecycleRecord;
        const replay = replayDecision(
          record,
          command.idempotencyKey,
          fingerprint,
        );
        if (replay !== undefined) return replay;
        const asset = record.asset;
        if (asset === undefined) return missingAsset();
        if (asset.householdId !== command.actor.householdId) {
          return scopeMismatch();
        }
        if (asset.lifecycleState === "purging") {
          return {
            kind: "return",
            result: {
              kind: "conflict",
              code: "ASSET_PURGING_NOT_RESTORABLE",
            },
          };
        }
        if (asset.aggregateVersion !== command.expectedVersion) {
          return {
            kind: "return",
            result: { kind: "conflict", code: "ASSET_VERSION_MISMATCH" },
          };
        }
        if (asset.lifecycleState !== "deleted") {
          return {
            kind: "return",
            result: { kind: "conflict", code: "ASSET_NOT_DELETED" },
          };
        }

        const participant = this.dependencies.restorationParticipant.prepare({
          assetId: asset.assetId,
          householdId: asset.householdId,
          ...(asset.deletedAt === undefined
            ? {}
            : { deletedAt: asset.deletedAt }),
          restoredOn: command.restoredOn,
          ...(snapshot.participantState === undefined
            ? {}
            : { state: snapshot.participantState }),
        });
        if (participant.kind !== "prepared") {
          return {
            kind: "return",
            result: { kind: participant.kind, code: participant.code },
          };
        }

        const nextAsset = nextLifecycleAsset(asset, "active");
        const receipt: AssetLifecycleReceipt = {
          commandId: command.commandId,
          assetId: asset.assetId,
          operation: "restore",
          resultingVersion: nextAsset.aggregateVersion,
        };
        const result: AssetLifecycleCommandResult = {
          kind: "success",
          asset: nextAsset,
          receipt,
          ...(participant.resumeFromDate === undefined
            ? {}
            : { resumeFromDate: participant.resumeFromDate }),
        };
        const nextLifecycleRecord: AssetLifecycleRecord = {
          ...record,
          asset: nextAsset,
          commandReceipts: {
            ...record.commandReceipts,
            [command.idempotencyKey]: {
              payloadFingerprint: fingerprint,
              result,
            },
          },
        };
        return {
          kind: "commit",
          nextLifecycleRecord,
          ...(participant.nextState === undefined
            ? {}
            : { nextParticipantState: participant.nextState }),
          receipt,
          events: [
            {
              eventType: "AssetLifecycleChanged.v1",
              assetId: asset.assetId,
              before: "deleted",
              after: "active",
              aggregateVersion: nextAsset.aggregateVersion,
              ...(participant.resumeFromDate === undefined
                ? {}
                : { resumeFromDate: participant.resumeFromDate }),
            } satisfies AssetLifecycleEvent,
          ],
          auditRecords: [
            {
              commandId: command.commandId,
              actorId: command.actor.actorId,
              assetId: asset.assetId,
              operation: "restore",
              reason: reason.value,
            },
          ],
          result,
        };
      },
    );
  }

  async requestPermanentAssetPurge(
    command: RequestPermanentAssetPurgeCommand,
  ): Promise<AssetLifecycleCommandResult> {
    if (
      !hasCapability(
        command.actor.capabilities,
        "portfolio.asset.purge.permanent",
      )
    ) {
      return { kind: "forbidden", code: "ASSET_PURGE_FORBIDDEN" };
    }
    const confirmation = validateRequiredText(
      command.confirmationRef,
      "ASSET_PURGE_CONFIRMATION_REQUIRED",
    );
    if (confirmation.kind === "invalid") {
      return { kind: "validation-error", code: confirmation.code };
    }
    const processId = this.dependencies.ids.purgeProcessId(
      command.idempotencyKey,
    );
    const fingerprint = this.dependencies.hash.hash(
      lifecyclePayloadFingerprint({
        actorId: command.actor.actorId,
        householdId: command.actor.householdId,
        assetId: command.assetId,
        expectedVersion: command.expectedVersion,
        confirmationRef: confirmation.value,
      }),
    );
    return this.dependencies.unitOfWork.transact(command.assetId, (record) => {
      const replay = replayDecision(record, command.idempotencyKey, fingerprint);
      if (replay !== undefined) return replay;
      const asset = record.asset;
      if (asset === undefined) return missingAsset();
      if (asset.householdId !== command.actor.householdId) return scopeMismatch();
      if (asset.aggregateVersion !== command.expectedVersion) {
        return {
          kind: "return",
          result: { kind: "conflict", code: "ASSET_VERSION_MISMATCH" },
        };
      }
      if (asset.lifecycleState === "purging" || record.purgeProcess !== undefined) {
        return {
          kind: "return",
          result: { kind: "conflict", code: "ASSET_PURGE_ALREADY_STARTED" },
        };
      }
      if (asset.lifecycleState !== "deleted") {
        return {
          kind: "return",
          result: { kind: "conflict", code: "ASSET_NOT_DELETED" },
        };
      }

      const nextAsset = nextLifecycleAsset(
        asset,
        "purging",
        asset.deletedAt,
      );
      const process = {
        processId,
        assetId: asset.assetId,
        confirmationRefHash:
          this.dependencies.hash.hash(`confirmation:${confirmation.value}`),
        status: "in-progress" as const,
        participants: initialPurgeParticipants(),
      };
      const receipt: AssetLifecycleReceipt = {
        commandId: command.commandId,
        assetId: asset.assetId,
        operation: "purge-request",
        resultingVersion: nextAsset.aggregateVersion,
      };
      const result: AssetLifecycleCommandResult = {
        kind: "purge-requested",
        asset: nextAsset,
        process,
        receipt,
      };
      return commitDecision({
        current: record,
        next: { ...record, asset: nextAsset, purgeProcess: process },
        idempotencyKey: command.idempotencyKey,
        payloadFingerprint: fingerprint,
        receipt,
        auditRecords: [
          {
            commandId: command.commandId,
            actorId: command.actor.actorId,
            assetId: asset.assetId,
            operation: "purge-request",
            confirmationRefHash: process.confirmationRefHash,
          },
        ],
        result,
      });
    });
  }

  async applyPermanentAssetPurgePage(
    command: ApplyPermanentAssetPurgePageCommand,
  ): Promise<AssetLifecycleCommandResult> {
    if (
      !hasCapability(command.actor.capabilities, "portfolio.asset.purge.process")
    ) {
      return { kind: "forbidden", code: "ASSET_PURGE_PROCESS_FORBIDDEN" };
    }
    if (!Number.isSafeInteger(command.limit) || command.limit <= 0) {
      return { kind: "validation-error", code: "INVALID_PURGE_PAGE_LIMIT" };
    }
    const pageReceiptKey = `purge-page:${command.processId}:${command.participant}:${command.cursor ?? "start"}`;
    const fingerprint = this.dependencies.hash.hash(
      lifecyclePayloadFingerprint({
        householdId: command.actor.householdId,
        assetId: command.assetId,
        processId: command.processId,
        participant: command.participant,
        cursor: command.cursor,
        limit: command.limit,
        pageOutcome: command.pageOutcome,
      }),
    );
    return this.dependencies.unitOfWork.transact(command.assetId, (record) => {
      const replay = replayDecision(record, pageReceiptKey, fingerprint);
      if (replay !== undefined) return replay;
      const asset = record.asset;
      const process = record.purgeProcess;
      if (asset === undefined || process === undefined) return missingAsset();
      if (asset.householdId !== command.actor.householdId) return scopeMismatch();
      if (
        asset.lifecycleState !== "purging" ||
        process.processId !== command.processId ||
        process.assetId !== command.assetId
      ) {
        return {
          kind: "return",
          result: { kind: "conflict", code: "ASSET_PURGE_PROCESS_MISMATCH" },
        };
      }

      const currentProgress = process.participants[command.participant];
      if (currentProgress.status === "completed") {
        return {
          kind: "return",
          result: {
            kind: "conflict",
            code: "PURGE_PARTICIPANT_ALREADY_COMPLETED",
          },
        };
      }
      if (currentProgress.checkpoint !== command.cursor) {
        return {
          kind: "return",
          result: { kind: "conflict", code: "PURGE_CHECKPOINT_MISMATCH" },
        };
      }

      const receipt: AssetLifecycleReceipt = {
        commandId: command.commandId,
        assetId: command.assetId,
        operation: "purge-page",
        resultingVersion: asset.aggregateVersion,
      };
      if (command.pageOutcome.kind === "retryable-failure") {
        const nextProcess = this.nextProcess(
          process,
          command.participant,
          "in-progress",
          command.pageOutcome.checkpoint,
        );
        const result: AssetLifecycleCommandResult = {
          kind: "retryable-failure",
          code: command.pageOutcome.code,
          checkpoint: command.pageOutcome.checkpoint,
        };
        return commitDecision({
          current: record,
          next: { ...record, purgeProcess: nextProcess },
          idempotencyKey: pageReceiptKey,
          payloadFingerprint: fingerprint,
          receipt,
          result,
        });
      }

      const nextProcess = this.nextProcess(
        process,
        command.participant,
        command.pageOutcome.kind === "participant-completed"
          ? "completed"
          : "in-progress",
        command.pageOutcome.kind === "participant-completed"
          ? command.pageOutcome.finalCheckpoint
          : command.pageOutcome.checkpoint,
      );
      const allCompleted = Object.values(nextProcess.participants).every(
        (progress) => progress.status === "completed",
      );
      if (!allCompleted) {
        const result: AssetLifecycleCommandResult = {
          kind: "purge-page-processed",
          process: nextProcess,
          receipt,
        };
        return commitDecision({
          current: record,
          next: { ...record, purgeProcess: nextProcess },
          idempotencyKey: pageReceiptKey,
          payloadFingerprint: fingerprint,
          receipt,
          result,
        });
      }

      const completedAt = this.dependencies.clock.now();
      const completion = {
        processId: process.processId,
        completed: true as const,
        completedAt,
        resultHash: this.dependencies.hash.hash(
          `completed:${process.processId}:${completedAt}`,
        ),
      };
      const result: AssetLifecycleCommandResult = {
        kind: "purge-completed",
        completion,
        receipt,
      };
      return {
        kind: "commit",
        nextRecord: {
          commandReceipts: {},
          purgeCompletion: completion,
        },
        receipt,
        events: [],
        result,
      };
    });
  }

  async queryVisibleAsset(
    actor: DeleteAssetCommand["actor"],
    assetId: string,
  ): Promise<VisibleAssetResult> {
    if (!hasCapability(actor.capabilities, "portfolio.asset.read")) {
      return { kind: "forbidden", code: "ASSET_READ_FORBIDDEN" };
    }
    const record = await this.dependencies.unitOfWork.read(assetId);
    const asset = record?.asset;
    return asset !== undefined &&
      asset.householdId === actor.householdId &&
      asset.lifecycleState === "active"
      ? { kind: "success", asset }
      : { kind: "no-data" };
  }

  async listDeletedAssets(
    actor: DeleteAssetCommand["actor"],
  ): Promise<DeletedAssetListResult> {
    if (
      !hasCapability(actor.capabilities, "portfolio.asset.restore.read")
    ) {
      return { kind: "forbidden", code: "DELETED_ASSET_LIST_FORBIDDEN" };
    }
    const records = await this.dependencies.unitOfWork.listByHousehold(
      actor.householdId,
    );
    const assetIds = records
      .map((record) => record.asset)
      .filter(
        (asset): asset is NonNullable<typeof asset> =>
          asset !== undefined && asset.lifecycleState === "deleted",
      )
      .map((asset) => asset.assetId)
      .sort();
    return assetIds.length === 0
      ? { kind: "no-data" }
      : { kind: "success", assetIds };
  }

  private nextProcess(
    process: NonNullable<AssetLifecycleRecord["purgeProcess"]>,
    participant: AssetPurgeParticipant,
    status: "in-progress" | "completed",
    checkpoint: string,
  ): NonNullable<AssetLifecycleRecord["purgeProcess"]> {
    return {
      ...process,
      participants: {
        ...process.participants,
        [participant]: { status, checkpoint },
      },
    };
  }
}

export function createAssetLifecycleApplication(
  dependencies: AssetLifecycleApplicationDependencies,
): AssetLifecycleInputPort {
  return new DefaultAssetLifecycleApplication(dependencies);
}
