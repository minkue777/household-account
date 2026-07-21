import { createHouseholdPurgeProcessApplication } from "../../src/contexts/access/household-purge-process/application/householdPurgeProcessApplication";
import type {
  HouseholdPurgeAdministrativeActor,
  HouseholdPurgeProcessEvent,
  HouseholdPurgeProcessInputPort,
  HouseholdPurgeStatusResult,
  HouseholdPurgeSystemActor,
  RequestHouseholdPurgeResult,
  RunHouseholdPurgeProcessResult,
} from "../../src/contexts/access/household-purge-process/application/ports/in/householdPurgeProcessInputPort";
import type {
  HouseholdPurgeClockPort,
  HouseholdPurgeExecutionPort,
  HouseholdPurgeFaultPort,
  HouseholdPurgeHashPort,
  HouseholdPurgeIdentityPort,
  HouseholdPurgeMutation,
  HouseholdPurgeParticipantPort,
  HouseholdPurgeParticipantResult,
  HouseholdPurgeUnitOfWorkPort,
} from "../../src/contexts/access/household-purge-process/application/ports/out/householdPurgeProcessPorts";
import type {
  HouseholdPurgeAggregateState,
  HouseholdPurgeClaim,
  HouseholdPurgeParticipant,
  HouseholdPurgeProcessRecord,
} from "../../src/contexts/access/household-purge-process/domain/model/householdPurgeProcess";
import { HOUSEHOLD_PURGE_PARTICIPANTS } from "../../src/contexts/access/household-purge-process/domain/model/householdPurgeProcess";

export interface HouseholdPurgeProcessFixture {
  readonly householdId: string;
  readonly householdState: "active" | "deleted";
  readonly claimPageSize: number;
  readonly claims: readonly HouseholdPurgeClaim[];
  readonly contextDataDigests: Readonly<
    Record<HouseholdPurgeParticipant, string>
  >;
  readonly failOnce?:
    | { readonly phase: "claim-snapshot"; readonly checkpoint: string }
    | {
        readonly phase: "context-purge";
        readonly participant: HouseholdPurgeParticipant;
        readonly checkpoint: string;
      }
    | { readonly phase: "claim-finalization"; readonly checkpoint: string };
  readonly permanentFailure?: {
    readonly participant: HouseholdPurgeParticipant;
    readonly checkpoint: string;
  };
  readonly participantPageCounts?: Partial<
    Readonly<Record<HouseholdPurgeParticipant, number>>
  >;
}

export interface HouseholdPurgeProcessSnapshot {
  readonly householdState: "active" | "deleted" | "purging" | "purged";
  readonly process?: {
    readonly processId: string;
    readonly phase:
      | "claim-snapshot"
      | "context-purge"
      | "claim-finalization"
      | "completed";
    readonly snapshotEntryCount: number;
    readonly contextStatuses: Readonly<
      Record<HouseholdPurgeParticipant, "pending" | "completed">
    >;
    readonly releasedClaimCount: number;
    readonly absentClaimCount: number;
    readonly claimConflicts: readonly {
      readonly claimRef: string;
      readonly reason: "CURRENT_CLAIM_CHANGED";
    }[];
  };
  readonly currentClaims: readonly HouseholdPurgeClaim[];
  readonly contextDataDigests: Readonly<
    Record<HouseholdPurgeParticipant, string | undefined>
  >;
}

export interface PurgeParticipantCall {
  readonly processId: string;
  readonly participant: HouseholdPurgeParticipant;
  readonly checkpoint: string;
  readonly result:
    | "page-processed"
    | "purge-completed"
    | "retryable-failure"
    | "permanent-failure";
}

export interface HouseholdPurgeProcessFixtureSubject
  extends HouseholdPurgeProcessInputPort {
  removeCurrentClaimForTest(claimRef: string): void;
  replaceCurrentClaimForTest(
    claimRef: string,
    replacement: Omit<HouseholdPurgeClaim, "claimRef">,
  ): void;
  resolveSignedInUserAfterPurge(
    principalRef: string,
  ): Promise<
    | { readonly kind: "first-visit-required"; readonly choices: readonly ["create", "join"] }
    | {
        readonly kind: "membership-found";
        readonly householdId: string;
        readonly membershipId: string;
      }
  >;
  snapshot(): Promise<HouseholdPurgeProcessSnapshot>;
  participantCalls(): readonly PurgeParticipantCall[];
  publishedEvents(): Promise<readonly HouseholdPurgeProcessEvent[]>;
}

function cloneProcess(
  process: HouseholdPurgeProcessRecord,
): HouseholdPurgeProcessRecord {
  return {
    ...process,
    claimSnapshotEntries: process.claimSnapshotEntries.map((entry) => ({
      ...entry,
    })),
    participants: Object.fromEntries(
      HOUSEHOLD_PURGE_PARTICIPANTS.map((participant) => [
        participant,
        { ...process.participants[participant] },
      ]),
    ) as unknown as HouseholdPurgeProcessRecord["participants"],
    claimConflicts: process.claimConflicts.map((conflict) => ({ ...conflict })),
  };
}

function cloneState(
  state: HouseholdPurgeAggregateState,
): HouseholdPurgeAggregateState {
  return {
    household: { ...state.household },
    currentClaims: state.currentClaims.map((claim) => ({ ...claim })),
    processes: Object.fromEntries(
      Object.entries(state.processes).map(([processId, process]) => [
        processId,
        cloneProcess(process),
      ]),
    ),
    requestReceipts: Object.fromEntries(
      Object.entries(state.requestReceipts).map(([key, receipt]) => [
        key,
        { ...receipt },
      ]),
    ),
    events: state.events.map((event) => ({ ...event })),
  };
}

class FixtureHouseholdPurgeUnitOfWork
  implements HouseholdPurgeUnitOfWorkPort
{
  private stateValue: HouseholdPurgeAggregateState;
  private serial: Promise<void> = Promise.resolve();

  constructor(fixture: HouseholdPurgeProcessFixture) {
    this.stateValue = {
      household: {
        householdId: fixture.householdId,
        lifecycleState: fixture.householdState,
        aggregateVersion: 8,
      },
      currentClaims: fixture.claims.map((claim) => ({ ...claim })),
      processes: {},
      requestReceipts: {},
      events: [],
    };
  }

  async read(): Promise<HouseholdPurgeAggregateState> {
    await this.serial;
    return cloneState(this.stateValue);
  }

  async transact<T>(
    operation: (
      state: HouseholdPurgeAggregateState,
    ) => HouseholdPurgeMutation<T>,
  ): Promise<T> {
    const transaction = this.serial.then(() => {
      const mutation = operation(cloneState(this.stateValue));
      this.stateValue = cloneState(mutation.state);
      return mutation.value;
    });
    this.serial = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }

  removeClaim(claimRef: string): void {
    this.stateValue = {
      ...this.stateValue,
      currentClaims: this.stateValue.currentClaims.filter(
        (claim) => claim.claimRef !== claimRef,
      ),
    };
  }

  replaceClaim(
    claimRef: string,
    replacement: Omit<HouseholdPurgeClaim, "claimRef">,
  ): void {
    this.stateValue = {
      ...this.stateValue,
      currentClaims: this.stateValue.currentClaims.map((claim) =>
        claim.claimRef === claimRef ? { claimRef, ...replacement } : claim,
      ),
    };
  }
}

class FixtureHouseholdPurgeFaults implements HouseholdPurgeFaultPort {
  private consumed = false;

  constructor(
    private readonly failure: HouseholdPurgeProcessFixture["failOnce"],
  ) {}

  beforeStep(input: {
    readonly phase:
      | "claim-snapshot"
      | "context-purge"
      | "claim-finalization";
    readonly checkpoint: string;
    readonly participant?: HouseholdPurgeParticipant;
  }): { readonly kind: "proceed" } | { readonly kind: "retryable-failure" } {
    if (
      !this.consumed &&
      this.failure !== undefined &&
      this.failure.phase !== "context-purge" &&
      this.failure.phase === input.phase &&
      this.failure.checkpoint === input.checkpoint
    ) {
      this.consumed = true;
      return { kind: "retryable-failure" };
    }
    return { kind: "proceed" };
  }
}

class FixtureHouseholdPurgeParticipants
  implements HouseholdPurgeParticipantPort
{
  private readonly digests: Record<
    HouseholdPurgeParticipant,
    string | undefined
  >;
  private readonly calls: PurgeParticipantCall[] = [];
  private readonly successfulPageCounts = new Map<HouseholdPurgeParticipant, number>();
  private retryableFailureConsumed = false;

  constructor(private readonly fixture: HouseholdPurgeProcessFixture) {
    this.digests = { ...fixture.contextDataDigests };
  }

  async purgeHouseholdData(input: {
    readonly householdId: string;
    readonly processId: string;
    readonly participant: HouseholdPurgeParticipant;
    readonly checkpoint: string;
  }): Promise<HouseholdPurgeParticipantResult> {
    const retryable = this.fixture.failOnce;
    if (
      !this.retryableFailureConsumed &&
      retryable?.phase === "context-purge" &&
      retryable.participant === input.participant &&
      retryable.checkpoint === input.checkpoint
    ) {
      this.retryableFailureConsumed = true;
      this.calls.push({ ...input, result: "retryable-failure" });
      return {
        kind: "retryable-failure",
        retryCheckpoint: input.checkpoint,
        errorCode: "FIXTURE_RETRYABLE_FAILURE",
      };
    }
    const permanent = this.fixture.permanentFailure;
    if (
      permanent?.participant === input.participant &&
      permanent.checkpoint === input.checkpoint
    ) {
      this.calls.push({ ...input, result: "permanent-failure" });
      return {
        kind: "permanent-failure",
        failedCheckpoint: input.checkpoint,
        errorCode: "FIXTURE_PERMANENT_FAILURE",
      };
    }

    const processedPages =
      (this.successfulPageCounts.get(input.participant) ?? 0) + 1;
    this.successfulPageCounts.set(input.participant, processedPages);
    const requiredPages = Math.max(
      1,
      this.fixture.participantPageCounts?.[input.participant] ?? 1,
    );
    if (processedPages < requiredPages) {
      this.calls.push({ ...input, result: "page-processed" });
      return {
        kind: "page-processed",
        nextCheckpoint: `${input.participant}:page:${processedPages}`,
        deletedCount: 1,
      };
    }

    this.digests[input.participant] = undefined;
    this.calls.push({ ...input, result: "purge-completed" });
    return {
      kind: "purge-completed",
      finalCheckpoint: `${input.participant}:complete`,
      deletedCount: 1,
    };
  }

  snapshotDigests(): Readonly<
    Record<HouseholdPurgeParticipant, string | undefined>
  > {
    return { ...this.digests };
  }

  recordedCalls(): readonly PurgeParticipantCall[] {
    return this.calls.map((call) => ({ ...call }));
  }
}

class FixtureHouseholdPurgeIdentity implements HouseholdPurgeIdentityPort {
  processId(idempotencyKey: string): string {
    return `household-purge:${idempotencyKey}`;
  }
}

class FixtureHouseholdPurgeExecution implements HouseholdPurgeExecutionPort {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(
    processId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.tails.get(processId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(processId, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(processId) === tail) {
        this.tails.delete(processId);
      }
    }
  }
}

class FixtureHouseholdPurgeHash implements HouseholdPurgeHashPort {
  hash(value: string): string {
    return `hash:${value.length}`;
  }
}

class FixtureHouseholdPurgeClock implements HouseholdPurgeClockPort {
  now(): string {
    return "2026-07-21T00:00:00.000Z";
  }
}

class HouseholdPurgeProcessFixtureDriver
  implements HouseholdPurgeProcessFixtureSubject
{
  constructor(
    private readonly application: HouseholdPurgeProcessInputPort,
    private readonly unitOfWork: FixtureHouseholdPurgeUnitOfWork,
    private readonly participants: FixtureHouseholdPurgeParticipants,
  ) {}

  requestPermanentHouseholdPurge(
    actor: HouseholdPurgeAdministrativeActor,
    input: Parameters<
      HouseholdPurgeProcessInputPort["requestPermanentHouseholdPurge"]
    >[1],
  ): Promise<RequestHouseholdPurgeResult> {
    return this.application.requestPermanentHouseholdPurge(actor, input);
  }

  runHouseholdPurgeProcess(
    actor: HouseholdPurgeSystemActor,
    processId: string,
  ): Promise<RunHouseholdPurgeProcessResult> {
    return this.application.runHouseholdPurgeProcess(actor, processId);
  }

  getHouseholdPurgeStatus(
    actor: HouseholdPurgeAdministrativeActor,
    processId: string,
  ): Promise<HouseholdPurgeStatusResult> {
    return this.application.getHouseholdPurgeStatus(actor, processId);
  }

  removeCurrentClaimForTest(claimRef: string): void {
    this.unitOfWork.removeClaim(claimRef);
  }

  replaceCurrentClaimForTest(
    claimRef: string,
    replacement: Omit<HouseholdPurgeClaim, "claimRef">,
  ): void {
    this.unitOfWork.replaceClaim(claimRef, replacement);
  }

  async resolveSignedInUserAfterPurge(
    principalRef: string,
  ): Promise<
    | { readonly kind: "first-visit-required"; readonly choices: readonly ["create", "join"] }
    | {
        readonly kind: "membership-found";
        readonly householdId: string;
        readonly membershipId: string;
      }
  > {
    const state = await this.unitOfWork.read();
    const claim = state.currentClaims.find(
      (candidate) => candidate.principalRef === principalRef,
    );
    return claim === undefined
      ? { kind: "first-visit-required", choices: ["create", "join"] }
      : {
          kind: "membership-found",
          householdId: claim.householdId,
          membershipId: claim.membershipId,
        };
  }

  async snapshot(): Promise<HouseholdPurgeProcessSnapshot> {
    const state = await this.unitOfWork.read();
    const process = Object.values(state.processes)[0];
    return {
      householdState: state.household.lifecycleState,
      ...(process === undefined
        ? {}
        : {
            process: {
              processId: process.processId,
              phase: process.phase,
              snapshotEntryCount: process.claimSnapshotEntries.length,
              contextStatuses: Object.fromEntries(
                HOUSEHOLD_PURGE_PARTICIPANTS.map((participant) => [
                  participant,
                  process.participants[participant].status,
                ]),
              ) as unknown as Readonly<
                Record<HouseholdPurgeParticipant, "pending" | "completed">
              >,
              releasedClaimCount: process.releasedClaimCount,
              absentClaimCount: process.absentClaimCount,
              claimConflicts: process.claimConflicts.map((conflict) => ({
                ...conflict,
              })),
            },
          }),
      currentClaims: state.currentClaims.map((claim) => ({ ...claim })),
      contextDataDigests: this.participants.snapshotDigests(),
    };
  }

  participantCalls(): readonly PurgeParticipantCall[] {
    return this.participants.recordedCalls();
  }

  async publishedEvents(): Promise<readonly HouseholdPurgeProcessEvent[]> {
    return (await this.unitOfWork.read()).events.map((event) => ({ ...event }));
  }
}

export function createHouseholdPurgeProcessFixtureSubject(
  fixture: HouseholdPurgeProcessFixture,
): HouseholdPurgeProcessFixtureSubject {
  const unitOfWork = new FixtureHouseholdPurgeUnitOfWork(fixture);
  const participants = new FixtureHouseholdPurgeParticipants(fixture);
  return new HouseholdPurgeProcessFixtureDriver(
    createHouseholdPurgeProcessApplication({
      unitOfWork,
      participants,
      faults: new FixtureHouseholdPurgeFaults(fixture.failOnce),
      identities: new FixtureHouseholdPurgeIdentity(),
      hash: new FixtureHouseholdPurgeHash(),
      clock: new FixtureHouseholdPurgeClock(),
      claimPageSize: fixture.claimPageSize,
      execution: new FixtureHouseholdPurgeExecution(),
    }),
    unitOfWork,
    participants,
  );
}
