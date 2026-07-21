import { createAssetLifecycleApplication } from "../../src/contexts/portfolio/core/application/assetLifecycleApplication";
import type {
  AssetLifecycleClockPort,
  AssetLifecycleHashPort,
  AssetLifecycleIdPort,
  AssetRestorationWorkflowDecision,
  AssetLifecycleUnitOfWorkPort,
} from "../../src/contexts/portfolio/core/application/ports/out/assetLifecyclePorts";
import {
  mapLegacyAssetLifecycle,
  type AssetLifecycleDecision,
  type AssetLifecycleRecord,
} from "../../src/contexts/portfolio/core/domain/model/assetLifecycle";
import type {
  AssetLifecycleActor,
  AssetLifecycleAuditRecord,
  AssetLifecycleCommandResult,
  AssetLifecycleEvent,
  AssetLifecycleInputPort,
  AssetLifecycleReceipt,
  AssetLifecycleView as CoreAssetLifecycleView,
  AssetPurgeCompletionView,
  AssetPurgeParticipant,
  AssetPurgeProcessView,
  CanonicalAssetLifecycle,
  DeletedAssetListResult,
  VisibleAssetResult,
} from "../../src/contexts/portfolio/core/public";

export type Actor = AssetLifecycleActor;
export type AssetLifecycle = CanonicalAssetLifecycle;
export type LifecycleReceipt = AssetLifecycleReceipt;
export type LifecycleEvent = AssetLifecycleEvent;
export type LifecycleCommandResult = AssetLifecycleCommandResult;

export interface AssetLifecycleView {
  readonly assetId: string;
  readonly householdId: string;
  readonly lifecycle: AssetLifecycle;
  readonly aggregateVersion: number;
  readonly deletedAt?: string;
}

export interface AssetDependentState {
  readonly positions: readonly {
    readonly positionId: string;
    readonly retained: boolean;
    readonly eligibleForProcessing: boolean;
  }[];
  readonly automation: {
    readonly retained: boolean;
    readonly executionEnabled: boolean;
    readonly nextDueDate: string;
  };
  readonly history: { readonly retained: boolean; readonly pointCount: number };
  readonly paidDividendEvents: readonly {
    readonly eventId: string;
    readonly amountInWon: number;
  }[];
  readonly annualDividendTotalInWon: number;
}

export interface AssetLifecycleOperationalState {
  readonly asset?: AssetLifecycleView;
  readonly dependents: AssetDependentState;
  readonly purgeProcess?: AssetPurgeProcessView;
  readonly purgeCompletion?: AssetPurgeCompletionView;
}

export interface AssetLifecycleFixtureState
  extends AssetLifecycleOperationalState {
  readonly asset: AssetLifecycleView;
}

export interface PurgePageFixture {
  readonly participant: AssetPurgeParticipant;
  readonly cursorBefore?: string;
  readonly cursorAfter: string;
  readonly outcome:
    | "page-processed"
    | "participant-completed"
    | "retryable-failure";
}

export interface AssetLifecycleWorkflowFixture {
  readonly state: AssetLifecycleFixtureState;
  readonly legacyIsActive?: boolean;
  readonly now?: string;
  readonly restoreResumeFromDate?: string;
  readonly purgePages?: readonly PurgePageFixture[];
}

export interface AssetLifecycleWorkflowDriver {
  deleteAsset(command: {
    readonly actor: Actor;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly assetId: string;
    readonly expectedVersion: number;
  }): Promise<LifecycleCommandResult>;
  restoreAsset(command: {
    readonly actor: Actor;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly assetId: string;
    readonly expectedVersion: number;
    readonly auditReason: string;
    readonly restoredOn?: string;
  }): Promise<LifecycleCommandResult>;
  requestPermanentPurge(command: {
    readonly actor: Actor;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly assetId: string;
    readonly expectedVersion: number;
    readonly confirmationRef: string;
  }): Promise<LifecycleCommandResult>;
  continuePermanentPurge(command: {
    readonly actor: Actor;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly assetId: string;
    readonly processId: string;
    readonly participant: AssetPurgeParticipant;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<LifecycleCommandResult>;
  queryVisibleAsset(actor: Actor, assetId: string): Promise<VisibleAssetResult>;
  listDeletedAssetIds(actor: Actor): Promise<DeletedAssetListResult>;
  inspectOperationalState(
    assetId: string,
  ): Promise<AssetLifecycleOperationalState>;
  receipts(): readonly LifecycleReceipt[];
  recordedEvents(): readonly LifecycleEvent[];
  auditRecords(): readonly AssetLifecycleAuditRecord[];
  purgeParticipantCalls(): readonly AssetPurgeParticipant[];
  physicalDeleteAttemptsFromUserDelete(): number;
}

function cloneLifecycleAsset(
  asset: CoreAssetLifecycleView,
): CoreAssetLifecycleView {
  return { ...asset };
}

function cloneRecord(record: AssetLifecycleRecord): AssetLifecycleRecord {
  return structuredClone(record);
}

function toCoreAsset(asset: AssetLifecycleView) {
  return {
    assetId: asset.assetId,
    householdId: asset.householdId,
    lifecycleState: asset.lifecycle,
    aggregateVersion: asset.aggregateVersion,
    ...(asset.deletedAt === undefined ? {} : { deletedAt: asset.deletedAt }),
  };
}

function toFixtureAsset(
  asset: CoreAssetLifecycleView,
): AssetLifecycleView {
  return {
    assetId: asset.assetId,
    householdId: asset.householdId,
    lifecycle: asset.lifecycleState,
    aggregateVersion: asset.aggregateVersion,
    ...(asset.deletedAt === undefined ? {} : { deletedAt: asset.deletedAt }),
  };
}

function cloneDependents(state: AssetDependentState): AssetDependentState {
  return {
    positions: state.positions.map((position) => ({ ...position })),
    automation: { ...state.automation },
    history: { ...state.history },
    paidDividendEvents: state.paidDividendEvents.map((event) => ({ ...event })),
    annualDividendTotalInWon: state.annualDividendTotalInWon,
  };
}

class LifecycleWorkflowUnitOfWork implements AssetLifecycleUnitOfWorkPort {
  private record: AssetLifecycleRecord;
  private restorationParticipantState: unknown;
  private receiptLog: AssetLifecycleReceipt[] = [];
  private readonly eventLog: AssetLifecycleEvent[] = [];
  private auditLog: AssetLifecycleAuditRecord[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(asset: AssetLifecycleView, legacyIsActive?: boolean) {
    this.record = {
      asset: mapLegacyAssetLifecycle({
        asset: toCoreAsset(asset),
        ...(legacyIsActive === undefined ? {} : { legacyIsActive }),
      }),
      commandReceipts: {},
    };
  }

  transact(
    assetId: string,
    decide: (record: AssetLifecycleRecord) => AssetLifecycleDecision,
  ): Promise<AssetLifecycleCommandResult> {
    let resolveResult!: (result: AssetLifecycleCommandResult) => void;
    const result = new Promise<AssetLifecycleCommandResult>((resolve) => {
      resolveResult = resolve;
    });
    this.queue = this.queue.then(() => {
      const snapshot =
        this.record.asset?.assetId === assetId ||
        this.record.purgeProcess?.assetId === assetId
          ? cloneRecord(this.record)
          : { commandReceipts: {} };
      const decision = decide(snapshot);
      if (decision.kind === "return") {
        resolveResult(structuredClone(decision.result));
        return;
      }
      this.record = cloneRecord(decision.nextRecord);
      this.receiptLog =
        decision.result.kind === "purge-completed"
          ? []
          : [...this.receiptLog, { ...decision.receipt }];
      this.eventLog.push(...decision.events.map((event) => ({ ...event })));
      this.auditLog =
        decision.result.kind === "purge-completed"
          ? []
          : [
              ...this.auditLog,
              ...(decision.auditRecords ?? []).map((record) => ({ ...record })),
            ];
      resolveResult(structuredClone(decision.result));
    });
    return result;
  }

  transactRestoration(
    assetId: string,
    decide: (snapshot: {
      readonly lifecycleRecord: AssetLifecycleRecord;
      readonly participantState?: unknown;
    }) => AssetRestorationWorkflowDecision,
  ): Promise<AssetLifecycleCommandResult> {
    let resolveResult!: (result: AssetLifecycleCommandResult) => void;
    const result = new Promise<AssetLifecycleCommandResult>((resolve) => {
      resolveResult = resolve;
    });
    this.queue = this.queue.then(() => {
      const lifecycleRecord =
        this.record.asset?.assetId === assetId
          ? cloneRecord(this.record)
          : { commandReceipts: {} };
      const decision = decide({
        lifecycleRecord,
        ...(this.restorationParticipantState === undefined
          ? {}
          : {
              participantState: structuredClone(
                this.restorationParticipantState,
              ),
            }),
      });
      if (decision.kind === "return") {
        resolveResult(structuredClone(decision.result));
        return;
      }
      this.record = cloneRecord(decision.nextLifecycleRecord);
      this.restorationParticipantState =
        decision.nextParticipantState === undefined
          ? undefined
          : structuredClone(decision.nextParticipantState);
      this.receiptLog.push({ ...decision.receipt });
      this.eventLog.push(...decision.events.map((event) => ({ ...event })));
      this.auditLog.push(
        ...decision.auditRecords.map((record) => ({ ...record })),
      );
      resolveResult(structuredClone(decision.result));
    });
    return result;
  }

  async read(assetId: string): Promise<AssetLifecycleRecord | undefined> {
    await this.queue;
    return this.record.asset?.assetId === assetId ||
      this.record.purgeProcess?.assetId === assetId
      ? cloneRecord(this.record)
      : this.record.purgeCompletion !== undefined
        ? cloneRecord(this.record)
        : undefined;
  }

  async listByHousehold(
    householdId: string,
  ): Promise<readonly AssetLifecycleRecord[]> {
    await this.queue;
    return this.record.asset?.householdId === householdId
      ? [cloneRecord(this.record)]
      : [];
  }

  receipts(): readonly AssetLifecycleReceipt[] {
    return this.receiptLog.map((receipt) => ({ ...receipt }));
  }

  events(): readonly AssetLifecycleEvent[] {
    return this.eventLog.map((event) => ({ ...event }));
  }

  auditRecords(): readonly AssetLifecycleAuditRecord[] {
    return this.auditLog.map((record) => ({ ...record }));
  }

  async snapshot(): Promise<AssetLifecycleRecord> {
    await this.queue;
    return cloneRecord(this.record);
  }
}

class FixedLifecycleClock implements AssetLifecycleClockPort {
  constructor(private readonly fixedNow: string) {}

  now(): string {
    return this.fixedNow;
  }
}

class DeterministicLifecycleIds implements AssetLifecycleIdPort {
  purgeProcessId(idempotencyKey: string): string {
    return `asset-purge:${idempotencyKey}`;
  }

}

class DeterministicLifecycleHash implements AssetLifecycleHashPort {
  hash(value: string): string {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `sha256:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
}

class DefaultAssetLifecycleWorkflowDriver
  implements AssetLifecycleWorkflowDriver
{
  private readonly unitOfWork: LifecycleWorkflowUnitOfWork;
  private readonly application: AssetLifecycleInputPort;
  private dependents: AssetDependentState;
  private readonly purgePages: PurgePageFixture[];
  private readonly purgePageReceipts = new Map<string, PurgePageFixture>();
  private readonly participantCalls: AssetPurgeParticipant[] = [];
  private readonly restoreResumeFromDate: string;

  constructor(fixture: AssetLifecycleWorkflowFixture) {
    this.unitOfWork = new LifecycleWorkflowUnitOfWork(
      fixture.state.asset,
      fixture.legacyIsActive,
    );
    this.application = createAssetLifecycleApplication({
      unitOfWork: this.unitOfWork,
      clock: new FixedLifecycleClock(
        fixture.now ?? "2026-03-20T09:00:00.000Z",
      ),
      ids: new DeterministicLifecycleIds(),
      hash: new DeterministicLifecycleHash(),
      restorationParticipant: {
        prepare: ({ state }) => ({
          kind: "prepared",
          ...(state === undefined ? {} : { nextState: state }),
          resumeFromDate: this.restoreResumeFromDate,
        }),
      },
    });
    this.dependents = cloneDependents(fixture.state.dependents);
    this.purgePages = (fixture.purgePages ?? []).map((page) => ({ ...page }));
    this.restoreResumeFromDate =
      fixture.restoreResumeFromDate ?? this.dependents.automation.nextDueDate;
  }

  deleteAsset(
    command: Parameters<AssetLifecycleWorkflowDriver["deleteAsset"]>[0],
  ): Promise<LifecycleCommandResult> {
    return this.application.deleteAsset(command);
  }

  async restoreAsset(
    command: Parameters<AssetLifecycleWorkflowDriver["restoreAsset"]>[0],
  ): Promise<LifecycleCommandResult> {
    const result = await this.application.restoreDeletedAsset({
      ...command,
      restoredOn: command.restoredOn ?? "2026-05-17",
    });
    if (result.kind !== "success" || result.resumeFromDate === undefined) {
      return result;
    }
    return {
      kind: "success",
      asset: result.asset,
      receipt: result.receipt,
    };
  }

  requestPermanentPurge(
    command: Parameters<
      AssetLifecycleWorkflowDriver["requestPermanentPurge"]
    >[0],
  ): Promise<LifecycleCommandResult> {
    return this.application.requestPermanentAssetPurge(command);
  }

  async continuePermanentPurge(
    command: Parameters<
      AssetLifecycleWorkflowDriver["continuePermanentPurge"]
    >[0],
  ): Promise<LifecycleCommandResult> {
    if (!command.actor.capabilities.includes("portfolio.asset.purge.process")) {
      return this.application.applyPermanentAssetPurgePage({
        ...command,
        pageOutcome: {
          kind: "page-processed",
          checkpoint: command.cursor ?? "not-executed",
        },
      });
    }
    const pageReceiptKey = `${command.processId}:${command.participant}:${command.cursor ?? "start"}`;
    const replayPage = this.purgePageReceipts.get(pageReceiptKey);
    const page = replayPage ?? this.purgePages.shift();
    if (
      page === undefined ||
      page.participant !== command.participant ||
      page.cursorBefore !== command.cursor
    ) {
      return { kind: "conflict", code: "PURGE_FIXTURE_PAGE_MISMATCH" };
    }
    if (replayPage === undefined) {
      this.purgePageReceipts.set(pageReceiptKey, { ...page });
      this.participantCalls.push(command.participant);
    }
    const pageOutcome =
      page.outcome === "retryable-failure"
        ? {
            kind: "retryable-failure" as const,
            code: "PURGE_PAGE_FAILED",
            checkpoint: page.cursorAfter,
          }
        : page.outcome === "participant-completed"
          ? {
              kind: "participant-completed" as const,
              finalCheckpoint: page.cursorAfter,
            }
          : {
              kind: "page-processed" as const,
              checkpoint: page.cursorAfter,
            };
    const result = await this.application.applyPermanentAssetPurgePage({
      ...command,
      pageOutcome,
    });
    if (
      page.outcome === "participant-completed" &&
      (result.kind === "purge-page-processed" ||
        result.kind === "purge-completed")
    ) {
      this.removeParticipantData(command.participant);
    }
    return result;
  }

  queryVisibleAsset(
    actor: Actor,
    assetId: string,
  ): Promise<VisibleAssetResult> {
    return this.application.queryVisibleAsset(actor, assetId);
  }

  listDeletedAssetIds(actor: Actor): Promise<DeletedAssetListResult> {
    return this.application.listDeletedAssets(actor);
  }

  async inspectOperationalState(
    _assetId: string,
  ): Promise<AssetLifecycleOperationalState> {
    const record = await this.unitOfWork.snapshot();
    const active = record.asset?.lifecycleState === "active";
    return {
      ...(record.asset === undefined
        ? {}
        : { asset: toFixtureAsset(cloneLifecycleAsset(record.asset)) }),
      dependents: {
        ...cloneDependents(this.dependents),
        positions: this.dependents.positions.map((position) => ({
          ...position,
          eligibleForProcessing: position.retained && active,
        })),
        automation: {
          ...this.dependents.automation,
          executionEnabled: this.dependents.automation.retained && active,
        },
      },
      ...(record.purgeProcess === undefined
        ? {}
        : { purgeProcess: structuredClone(record.purgeProcess) }),
      ...(record.purgeCompletion === undefined
        ? {}
        : { purgeCompletion: { ...record.purgeCompletion } }),
    };
  }

  receipts(): readonly LifecycleReceipt[] {
    return this.unitOfWork.receipts();
  }

  recordedEvents(): readonly LifecycleEvent[] {
    return this.unitOfWork.events();
  }

  auditRecords(): readonly AssetLifecycleAuditRecord[] {
    return this.unitOfWork.auditRecords();
  }

  purgeParticipantCalls(): readonly AssetPurgeParticipant[] {
    return [...this.participantCalls];
  }

  physicalDeleteAttemptsFromUserDelete(): number {
    return 0;
  }

  private removeParticipantData(participant: AssetPurgeParticipant): void {
    if (participant === "holdings") {
      this.dependents = { ...this.dependents, positions: [] };
      return;
    }
    if (participant === "automation") {
      this.dependents = {
        ...this.dependents,
        automation: {
          ...this.dependents.automation,
          retained: false,
          executionEnabled: false,
        },
      };
      return;
    }
    this.dependents = {
      ...this.dependents,
      history: { retained: false, pointCount: 0 },
    };
  }
}

export function createAssetLifecycleWorkflowDriver(
  fixture: AssetLifecycleWorkflowFixture,
): AssetLifecycleWorkflowDriver {
  return new DefaultAssetLifecycleWorkflowDriver(fixture);
}
