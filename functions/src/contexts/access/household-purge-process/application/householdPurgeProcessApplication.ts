import type {
  HouseholdPurgeAdministrativeActor,
  HouseholdPurgeProcessInputPort,
  HouseholdPurgeStatusResult,
  HouseholdPurgeSystemActor,
  RequestHouseholdPurgeResult,
  RunHouseholdPurgeProcessResult,
} from "./ports/in/householdPurgeProcessInputPort";
import type {
  HouseholdPurgeClockPort,
  HouseholdPurgeExecutionPort,
  HouseholdPurgeFaultPort,
  HouseholdPurgeHashPort,
  HouseholdPurgeIdentityPort,
  HouseholdPurgeParticipantPort,
  HouseholdPurgeUnitOfWorkPort,
} from "./ports/out/householdPurgeProcessPorts";
import type {
  HouseholdPurgeAggregateState,
  HouseholdPurgeClaim,
  HouseholdPurgeClaimConflict,
  HouseholdPurgeClaimSnapshotEntry,
  HouseholdPurgeParticipant,
  HouseholdPurgeProcessRecord,
} from "../domain/model/householdPurgeProcess";
import {
  HOUSEHOLD_PURGE_PARTICIPANTS,
  initialHouseholdPurgeParticipants,
  requestPurgePayloadFingerprint,
} from "../domain/model/householdPurgeProcess";

export interface HouseholdPurgeProcessApplicationDependencies {
  readonly unitOfWork: HouseholdPurgeUnitOfWorkPort;
  readonly participants: HouseholdPurgeParticipantPort;
  readonly faults: HouseholdPurgeFaultPort;
  readonly identities: HouseholdPurgeIdentityPort;
  readonly hash: HouseholdPurgeHashPort;
  readonly clock: HouseholdPurgeClockPort;
  readonly claimPageSize: number;
  readonly execution: HouseholdPurgeExecutionPort;
}

function hasCapability(
  capabilities: readonly string[],
  capability: string,
): boolean {
  return capabilities.includes(capability);
}

function snapshotCheckpointAfter(claimRef: string): string {
  return `snapshot:${claimRef}`;
}

function snapshotCursor(checkpoint: string): string | undefined {
  return checkpoint === "snapshot:start"
    ? undefined
    : checkpoint.slice("snapshot:".length);
}

function finalizationOffset(checkpoint: string): number {
  if (checkpoint === "finalization:start") return 0;
  const value = Number(checkpoint.slice("finalization:".length));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sortedTargetClaims(
  claims: readonly HouseholdPurgeClaim[],
  householdId: string,
): readonly HouseholdPurgeClaim[] {
  return claims
    .filter((claim) => claim.householdId === householdId)
    .slice()
    .sort((left, right) => left.claimRef.localeCompare(right.claimRef));
}

function asSnapshotEntry(
  claim: HouseholdPurgeClaim,
): HouseholdPurgeClaimSnapshotEntry {
  return {
    claimRef: claim.claimRef,
    membershipId: claim.membershipId,
    version: claim.version,
  };
}

class DefaultHouseholdPurgeProcessApplication
  implements HouseholdPurgeProcessInputPort
{
  constructor(
    private readonly dependencies: HouseholdPurgeProcessApplicationDependencies,
  ) {}

  async requestPermanentHouseholdPurge(
    actor: HouseholdPurgeAdministrativeActor,
    input: {
      readonly householdId: string;
      readonly confirmation: string;
      readonly expectedVersion: number;
      readonly idempotencyKey: string;
    },
  ): Promise<RequestHouseholdPurgeResult> {
    if (
      !hasCapability(actor.capabilities, "household.purge.permanent")
    ) {
      return {
        kind: "forbidden",
        code: "PERMANENT_PURGE_CAPABILITY_REQUIRED",
      };
    }
    const confirmation = input.confirmation.trim();
    if (confirmation.length === 0) {
      return { kind: "validation-error", code: "PURGE_CONFIRMATION_REQUIRED" };
    }
    const payloadFingerprint = this.dependencies.hash.hash(
      `purge-request:${requestPurgePayloadFingerprint({
        householdId: input.householdId,
        confirmation,
        expectedVersion: input.expectedVersion,
      })}`,
    );

    return this.dependencies.unitOfWork.transact<RequestHouseholdPurgeResult>(
      (state) => {
        const receipt = state.requestReceipts[input.idempotencyKey];
        if (receipt !== undefined) {
          return {
            state,
            value:
              receipt.payloadFingerprint === payloadFingerprint
                ? { kind: "accepted", processId: receipt.processId }
                : {
                    kind: "conflict",
                    code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
                  },
          };
        }
        if (
          state.household.householdId !== input.householdId ||
          state.household.lifecycleState !== "deleted"
        ) {
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

        const processId = this.dependencies.identities.processId(
          input.idempotencyKey,
        );
        const confirmationRefHash = this.dependencies.hash.hash(
          `confirmation:${confirmation}`,
        );
        const process: HouseholdPurgeProcessRecord = {
          processId,
          householdId: input.householdId,
          confirmationRefHash,
          phase: "claim-snapshot",
          claimPageSize:
            Number.isSafeInteger(this.dependencies.claimPageSize) &&
            this.dependencies.claimPageSize > 0
              ? this.dependencies.claimPageSize
              : 1,
          claimSnapshotCheckpoint: "snapshot:start",
          claimSnapshotEntries: [],
          participants: initialHouseholdPurgeParticipants(),
          claimFinalizationCheckpoint: "finalization:start",
          releasedClaimCount: 0,
          absentClaimCount: 0,
          claimConflicts: [],
        };
        const nextState: HouseholdPurgeAggregateState = {
          ...state,
          household: {
            ...state.household,
            lifecycleState: "purging",
            aggregateVersion: state.household.aggregateVersion + 1,
          },
          processes: { ...state.processes, [processId]: process },
          requestReceipts: {
            ...state.requestReceipts,
            [input.idempotencyKey]: {
              idempotencyKey: input.idempotencyKey,
              payloadFingerprint,
              processId,
            },
          },
          events: [
            ...state.events,
            {
              eventType: "HouseholdPermanentPurgeRequested.v1",
              householdId: input.householdId,
              processId,
              confirmationRefHash,
            },
          ],
        };
        return { state: nextState, value: { kind: "accepted", processId } };
      },
    );
  }

  async runHouseholdPurgeProcess(
    actor: HouseholdPurgeSystemActor,
    processId: string,
  ): Promise<RunHouseholdPurgeProcessResult> {
    if (
      !hasCapability(actor.capabilities, "householdLifecycle:purge")
    ) {
      return { kind: "forbidden", code: "PURGE_SYSTEM_CAPABILITY_REQUIRED" };
    }
    return this.dependencies.execution.runExclusive(processId, () =>
      this.runAuthorizedHouseholdPurgeProcess(processId),
    );
  }

  private async runAuthorizedHouseholdPurgeProcess(
    processId: string,
  ): Promise<RunHouseholdPurgeProcessResult> {
    const state = await this.dependencies.unitOfWork.read();
    const process = state.processes[processId];
    if (process === undefined) {
      return { kind: "not-found", code: "PURGE_PROCESS_NOT_FOUND" };
    }
    if (process.phase === "completed") {
      return { kind: "already-completed", processId };
    }
    if (process.phase === "claim-snapshot") {
      return this.runClaimSnapshotPage(process);
    }
    if (process.phase === "context-purge") {
      return this.runContextPurgePage(process);
    }
    return this.runClaimFinalizationPage(process);
  }

  async getHouseholdPurgeStatus(
    actor: HouseholdPurgeAdministrativeActor,
    processId: string,
  ): Promise<HouseholdPurgeStatusResult> {
    if (!hasCapability(actor.capabilities, "household.purge.read")) {
      return { kind: "Forbidden", code: "PURGE_READ_CAPABILITY_REQUIRED" };
    }
    const state = await this.dependencies.unitOfWork.read();
    const process = state.processes[processId];
    if (process === undefined) return { kind: "NotFound" };
    return {
      kind: "Success",
      value: {
        processId,
        householdState:
          state.household.lifecycleState === "purged" ? "purged" : "purging",
        phase: process.phase,
        completedParticipants: HOUSEHOLD_PURGE_PARTICIPANTS.filter(
          (participant) => process.participants[participant].status === "completed",
        ),
        releasedClaimCount: process.releasedClaimCount,
        absentClaimCount: process.absentClaimCount,
        claimConflictCount: process.claimConflicts.length,
      },
    };
  }

  private async runClaimSnapshotPage(
    observed: HouseholdPurgeProcessRecord,
  ): Promise<RunHouseholdPurgeProcessResult> {
    const checkpoint = observed.claimSnapshotCheckpoint;
    const fault = this.dependencies.faults.beforeStep({
      phase: "claim-snapshot",
      checkpoint,
    });
    if (fault.kind === "retryable-failure") {
      return {
        kind: "retryable-failure",
        processId: observed.processId,
        phase: "claim-snapshot",
        checkpoint,
        code: "CLAIM_READ_UNAVAILABLE",
      };
    }

    return this.dependencies.unitOfWork.transact<RunHouseholdPurgeProcessResult>(
      (state) => {
        const process = state.processes[observed.processId];
        if (process === undefined) {
          return {
            state,
            value: { kind: "not-found", code: "PURGE_PROCESS_NOT_FOUND" },
          };
        }
        if (
          process.phase !== "claim-snapshot" ||
          process.claimSnapshotCheckpoint !== checkpoint
        ) {
          return {
            state,
            value:
              process.phase === "completed"
                ? { kind: "already-completed", processId: process.processId }
                : {
                    kind: "progressed",
                    processId: process.processId,
                    phase: process.phase,
                    checkpoint:
                      process.phase === "context-purge"
                        ? process.participants[HOUSEHOLD_PURGE_PARTICIPANTS[0]]
                            .checkpoint
                        : process.claimFinalizationCheckpoint,
                  },
          };
        }

        const cursor = snapshotCursor(checkpoint);
        const candidates = sortedTargetClaims(
          state.currentClaims,
          process.householdId,
        ).filter(
          (claim) => cursor === undefined || claim.claimRef.localeCompare(cursor) > 0,
        );
        const page = candidates.slice(0, process.claimPageSize);
        const hasMore = candidates.length > page.length;
        const nextCheckpoint =
          page.length === 0 || !hasMore
            ? "snapshot:complete"
            : snapshotCheckpointAfter(page[page.length - 1].claimRef);
        const entries = [
          ...process.claimSnapshotEntries,
          ...page.map(asSnapshotEntry),
        ];
        const nextProcess: HouseholdPurgeProcessRecord = {
          ...process,
          phase: hasMore ? "claim-snapshot" : "context-purge",
          claimSnapshotCheckpoint: nextCheckpoint,
          claimSnapshotEntries: entries,
        };
        return {
          state: {
            ...state,
            processes: { ...state.processes, [process.processId]: nextProcess },
          },
          value: {
            kind: "progressed",
            processId: process.processId,
            phase: "claim-snapshot",
            checkpoint: nextCheckpoint,
          },
        };
      },
    );
  }

  private async runContextPurgePage(
    observed: HouseholdPurgeProcessRecord,
  ): Promise<RunHouseholdPurgeProcessResult> {
    const participant = HOUSEHOLD_PURGE_PARTICIPANTS.find(
      (candidate) => observed.participants[candidate].status !== "completed",
    );
    if (participant === undefined) {
      return this.dependencies.unitOfWork.transact<RunHouseholdPurgeProcessResult>((state) => {
        const current = state.processes[observed.processId];
        if (current === undefined) {
          return {
            state,
            value: {
              kind: "not-found" as const,
              code: "PURGE_PROCESS_NOT_FOUND" as const,
            },
          };
        }
        const next = { ...current, phase: "claim-finalization" as const };
        return {
          state: {
            ...state,
            processes: { ...state.processes, [current.processId]: next },
          },
          value: {
            kind: "progressed" as const,
            processId: current.processId,
            phase: "context-purge" as const,
            checkpoint: current.claimFinalizationCheckpoint,
          },
        };
      });
    }
    const progress = observed.participants[participant];
    const outcome = await this.dependencies.participants.purgeHouseholdData({
      householdId: observed.householdId,
      processId: observed.processId,
      participant,
      checkpoint: progress.checkpoint,
    });

    if (outcome.kind === "retryable-failure") {
      await this.recordParticipantFailure(
        observed.processId,
        participant,
        progress.checkpoint,
        outcome.errorCode,
      );
      return {
        kind: "retryable-failure",
        processId: observed.processId,
        phase: "context-purge",
        checkpoint: progress.checkpoint,
        participant,
        code: "PARTICIPANT_UNAVAILABLE",
      };
    }
    if (outcome.kind === "permanent-failure") {
      await this.recordParticipantFailure(
        observed.processId,
        participant,
        progress.checkpoint,
        outcome.errorCode,
      );
      return {
        kind: "operational-conflict",
        processId: observed.processId,
        phase: "context-purge",
        checkpoint: progress.checkpoint,
        participant,
        code: "PARTICIPANT_PERMANENT_FAILURE",
      };
    }

    const nextCheckpoint =
      outcome.kind === "page-processed"
        ? outcome.nextCheckpoint
        : outcome.finalCheckpoint;
    return this.dependencies.unitOfWork.transact<RunHouseholdPurgeProcessResult>(
      (state) => {
        const process = state.processes[observed.processId];
        if (process === undefined) {
          return {
            state,
            value: { kind: "not-found", code: "PURGE_PROCESS_NOT_FOUND" },
          };
        }
        const currentProgress = process.participants[participant];
        if (
          process.phase !== "context-purge" ||
          currentProgress.status === "completed" ||
          currentProgress.checkpoint !== progress.checkpoint
        ) {
          return {
            state,
            value: {
              kind: "progressed",
              processId: process.processId,
              phase:
                process.phase === "claim-finalization"
                  ? "claim-finalization"
                  : "context-purge",
              checkpoint:
                process.phase === "claim-finalization"
                  ? process.claimFinalizationCheckpoint
                  : currentProgress.checkpoint,
            },
          };
        }
        const participants = {
          ...process.participants,
          [participant]: {
            status:
              outcome.kind === "purge-completed"
                ? ("completed" as const)
                : ("pending" as const),
            checkpoint: nextCheckpoint,
          },
        };
        const allCompleted = HOUSEHOLD_PURGE_PARTICIPANTS.every(
          (candidate) => participants[candidate].status === "completed",
        );
        const nextProcess: HouseholdPurgeProcessRecord = {
          ...process,
          participants,
          phase: allCompleted ? "claim-finalization" : "context-purge",
        };
        return {
          state: {
            ...state,
            processes: { ...state.processes, [process.processId]: nextProcess },
          },
          value: {
            kind: "progressed",
            processId: process.processId,
            phase: "context-purge",
            checkpoint: nextCheckpoint,
          },
        };
      },
    );
  }

  private async recordParticipantFailure(
    processId: string,
    participant: HouseholdPurgeParticipant,
    checkpoint: string,
    errorCode: string,
  ): Promise<void> {
    await this.dependencies.unitOfWork.transact((state) => {
      const process = state.processes[processId];
      if (
        process === undefined ||
        process.phase !== "context-purge" ||
        process.participants[participant].checkpoint !== checkpoint
      ) {
        return { state, value: undefined };
      }
      const nextProcess: HouseholdPurgeProcessRecord = {
        ...process,
        participants: {
          ...process.participants,
          [participant]: {
            ...process.participants[participant],
            lastFailureCode: errorCode,
          },
        },
      };
      return {
        state: {
          ...state,
          processes: { ...state.processes, [processId]: nextProcess },
        },
        value: undefined,
      };
    });
  }

  private async runClaimFinalizationPage(
    observed: HouseholdPurgeProcessRecord,
  ): Promise<RunHouseholdPurgeProcessResult> {
    const checkpoint = observed.claimFinalizationCheckpoint;
    const fault = this.dependencies.faults.beforeStep({
      phase: "claim-finalization",
      checkpoint,
    });
    if (fault.kind === "retryable-failure") {
      return {
        kind: "retryable-failure",
        processId: observed.processId,
        phase: "claim-finalization",
        checkpoint,
        code: "CLAIM_FINALIZATION_UNAVAILABLE",
      };
    }

    return this.dependencies.unitOfWork.transact<RunHouseholdPurgeProcessResult>(
      (state) => {
        const process = state.processes[observed.processId];
        if (process === undefined) {
          return {
            state,
            value: { kind: "not-found", code: "PURGE_PROCESS_NOT_FOUND" },
          };
        }
        if (process.phase === "completed") {
          return {
            state,
            value: { kind: "already-completed", processId: process.processId },
          };
        }
        if (
          process.phase !== "claim-finalization" ||
          process.claimFinalizationCheckpoint !== checkpoint
        ) {
          return {
            state,
            value: {
              kind: "progressed",
              processId: process.processId,
              phase: process.phase as Exclude<typeof process.phase, "completed">,
              checkpoint: process.claimFinalizationCheckpoint,
            },
          };
        }

        const offset = finalizationOffset(checkpoint);
        const page = process.claimSnapshotEntries.slice(
          offset,
          offset + process.claimPageSize,
        );
        const claims = state.currentClaims.slice();
        let releasedClaimCount = process.releasedClaimCount;
        let absentClaimCount = process.absentClaimCount;
        const claimConflicts: HouseholdPurgeClaimConflict[] = [
          ...process.claimConflicts,
        ];

        for (const snapshot of page) {
          const currentIndex = claims.findIndex(
            (claim) => claim.claimRef === snapshot.claimRef,
          );
          if (currentIndex < 0) {
            absentClaimCount += 1;
            continue;
          }
          const current = claims[currentIndex];
          if (
            current.householdId === process.householdId &&
            current.membershipId === snapshot.membershipId &&
            current.version === snapshot.version
          ) {
            claims.splice(currentIndex, 1);
            releasedClaimCount += 1;
            continue;
          }
          claimConflicts.push({
            claimRef: snapshot.claimRef,
            reason: "CURRENT_CLAIM_CHANGED",
          });
        }

        const nextOffset = offset + page.length;
        const allFinalized =
          nextOffset >= process.claimSnapshotEntries.length;
        const nextCheckpoint = allFinalized
          ? "finalization:complete"
          : `finalization:${nextOffset}`;
        const nextProcess: HouseholdPurgeProcessRecord = {
          ...process,
          phase: allFinalized ? "completed" : "claim-finalization",
          claimFinalizationCheckpoint: nextCheckpoint,
          releasedClaimCount,
          absentClaimCount,
          claimConflicts,
        };
        if (!allFinalized) {
          return {
            state: {
              ...state,
              currentClaims: claims,
              processes: {
                ...state.processes,
                [process.processId]: nextProcess,
              },
            },
            value: {
              kind: "progressed",
              processId: process.processId,
              phase: "claim-finalization",
              checkpoint: nextCheckpoint,
            },
          };
        }

        return {
          state: {
            ...state,
            household: {
              ...state.household,
              lifecycleState: "purged",
              aggregateVersion: state.household.aggregateVersion + 1,
            },
            currentClaims: claims,
            processes: {
              ...state.processes,
              [process.processId]: nextProcess,
            },
            events: [
              ...state.events,
              {
                eventType: "HouseholdPurged.v1",
                householdIdHash: this.dependencies.hash.hash(
                  `household:${process.householdId}`,
                ),
                processId: process.processId,
                purgedAt: this.dependencies.clock.now(),
                releasedClaimCount,
              },
            ],
          },
          value: { kind: "completed", processId: process.processId },
        };
      },
    );
  }
}

export function createHouseholdPurgeProcessApplication(
  dependencies: HouseholdPurgeProcessApplicationDependencies,
): HouseholdPurgeProcessInputPort {
  return new DefaultHouseholdPurgeProcessApplication(dependencies);
}
