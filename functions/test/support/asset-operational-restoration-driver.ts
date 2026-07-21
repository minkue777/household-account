import { createAssetRestorationAutomationParticipant } from "../../src/contexts/portfolio/automation/application/assetRestorationParticipant";
import type { AssetAutomationRestorationState } from "../../src/contexts/portfolio/automation/domain/model/assetAutomationRestoration";
import { createAssetLifecycleApplication } from "../../src/contexts/portfolio/core/application/assetLifecycleApplication";
import type {
  AssetLifecycleClockPort,
  AssetLifecycleHashPort,
  AssetLifecycleIdPort,
  AssetLifecycleUnitOfWorkPort,
  AssetRestorationWorkflowDecision,
} from "../../src/contexts/portfolio/core/application/ports/out/assetLifecyclePorts";
import type {
  AssetLifecycleDecision,
  AssetLifecycleRecord,
} from "../../src/contexts/portfolio/core/domain/model/assetLifecycle";
import type {
  AssetLifecycleAuditRecord,
  AssetLifecycleCommandResult,
  AssetLifecycleEvent,
  AssetLifecycleReceipt,
  AssetLifecycleView,
} from "../../src/contexts/portfolio/core/public";

export interface OperationalRestorationActor {
  readonly kind: "member" | "administrator" | "operations-agent";
  readonly householdId: string;
  readonly capabilities: readonly string[];
}

export type OperationalAssetLifecycle = "active" | "deleted" | "purging";

export interface AssetOperationalRestorationSeed {
  readonly asset: {
    readonly householdId: string;
    readonly assetId: string;
    readonly lifecycle: OperationalAssetLifecycle;
    readonly version: number;
    readonly deletedOn?: string;
  };
  readonly automation?: {
    readonly configuredDay: number;
    readonly pendingMonths: readonly string[];
  };
  readonly failNextParticipantPreparation?: boolean;
  readonly failNextRestorationCommit?: boolean;
}

export type OperationalRestoreResult =
  | {
      readonly kind: "success";
      readonly assetId: string;
      readonly lifecycle: "active";
      readonly version: number;
      readonly resumeFromDate?: string;
    }
  | { readonly kind: "forbidden"; readonly code: string }
  | { readonly kind: "validation-error"; readonly code: string }
  | { readonly kind: "not-found"; readonly code: string }
  | { readonly kind: "conflict"; readonly code: string }
  | { readonly kind: "retryable-failure"; readonly code: string };

export type OperationalDeletedAssetsResult =
  | { readonly kind: "success"; readonly assetIds: readonly string[] }
  | { readonly kind: "forbidden"; readonly code: string };

export interface OperationalRestorationState {
  readonly asset?: {
    readonly householdId: string;
    readonly assetId: string;
    readonly lifecycle: OperationalAssetLifecycle;
    readonly version: number;
    readonly deletedOn?: string;
  };
  readonly automation?: AssetAutomationRestorationState;
}

export interface AssetOperationalRestorationDriver {
  restoreDeletedAsset(command: {
    readonly actor: OperationalRestorationActor;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly assetId: string;
    readonly restoredOn: string;
    readonly expectedVersion: number;
    readonly auditReason: string;
  }): Promise<OperationalRestoreResult>;
  listDeletedAssets(query: {
    readonly actor: OperationalRestorationActor;
  }): Promise<OperationalDeletedAssetsResult>;
  listDueMonths(query: {
    readonly actor: OperationalRestorationActor;
    readonly assetId: string;
    readonly asOfDate: string;
  }): Promise<readonly string[]>;
  inspectState(): Promise<OperationalRestorationState>;
  receipts(): readonly AssetLifecycleReceipt[];
  recordedEvents(): readonly AssetLifecycleEvent[];
  auditRecords(): readonly AssetLifecycleAuditRecord[];
}

function cloneLifecycleRecord(record: AssetLifecycleRecord): AssetLifecycleRecord {
  return structuredClone(record);
}

class OperationalRestorationUnitOfWork
  implements AssetLifecycleUnitOfWorkPort
{
  private lifecycleRecord: AssetLifecycleRecord;
  private participantState?: unknown;
  private readonly receiptLog: AssetLifecycleReceipt[] = [];
  private readonly eventLog: AssetLifecycleEvent[] = [];
  private readonly auditLog: AssetLifecycleAuditRecord[] = [];
  private queue: Promise<void> = Promise.resolve();
  private failNextRestorationCommit: boolean;

  constructor(seed: AssetOperationalRestorationSeed) {
    this.lifecycleRecord = {
      asset: {
        assetId: seed.asset.assetId,
        householdId: seed.asset.householdId,
        lifecycleState: seed.asset.lifecycle,
        aggregateVersion: seed.asset.version,
        ...(seed.asset.deletedOn === undefined
          ? {}
          : { deletedAt: seed.asset.deletedOn }),
      },
      commandReceipts: {},
    };
    this.participantState =
      seed.automation === undefined
        ? undefined
        : {
            assetId: seed.asset.assetId,
            configuredDay: seed.automation.configuredDay,
            pendingMonths: [...seed.automation.pendingMonths],
            suspensionIntervals: [],
            resumeRevisions: [],
          } satisfies AssetAutomationRestorationState;
    this.failNextRestorationCommit =
      seed.failNextRestorationCommit ?? false;
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
      const decision = decide(this.snapshotFor(assetId));
      if (decision.kind === "return") {
        resolveResult(structuredClone(decision.result));
        return;
      }
      this.lifecycleRecord = cloneLifecycleRecord(decision.nextRecord);
      this.receiptLog.push({ ...decision.receipt });
      this.eventLog.push(...decision.events.map((event) => ({ ...event })));
      this.auditLog.push(
        ...(decision.auditRecords ?? []).map((record) => ({ ...record })),
      );
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
      const decision = decide({
        lifecycleRecord: this.snapshotFor(assetId),
        ...(this.participantState === undefined
          ? {}
          : { participantState: structuredClone(this.participantState) }),
      });
      if (decision.kind === "return") {
        resolveResult(structuredClone(decision.result));
        return;
      }
      if (this.failNextRestorationCommit) {
        this.failNextRestorationCommit = false;
        resolveResult({
          kind: "retryable-failure",
          code: "ASSET_RESTORE_COMMIT_RETRYABLE",
        });
        return;
      }

      this.lifecycleRecord = cloneLifecycleRecord(
        decision.nextLifecycleRecord,
      );
      this.participantState =
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
    return this.lifecycleRecord.asset?.assetId === assetId
      ? cloneLifecycleRecord(this.lifecycleRecord)
      : undefined;
  }

  async listByHousehold(
    householdId: string,
  ): Promise<readonly AssetLifecycleRecord[]> {
    await this.queue;
    return this.lifecycleRecord.asset?.householdId === householdId
      ? [cloneLifecycleRecord(this.lifecycleRecord)]
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

  async state(): Promise<{
    readonly record: AssetLifecycleRecord;
    readonly participantState?: unknown;
  }> {
    await this.queue;
    return {
      record: cloneLifecycleRecord(this.lifecycleRecord),
      ...(this.participantState === undefined
        ? {}
        : { participantState: structuredClone(this.participantState) }),
    };
  }

  private snapshotFor(assetId: string): AssetLifecycleRecord {
    return this.lifecycleRecord.asset?.assetId === assetId
      ? cloneLifecycleRecord(this.lifecycleRecord)
      : { commandReceipts: {} };
  }
}

class FixedClock implements AssetLifecycleClockPort {
  now(): string {
    return "2026-05-17T00:00:00+09:00";
  }
}

class DeterministicIds implements AssetLifecycleIdPort {
  purgeProcessId(idempotencyKey: string): string {
    return `asset-purge:${idempotencyKey}`;
  }
}

class DeterministicHash implements AssetLifecycleHashPort {
  hash(value: string): string {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `sha256:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
}

function coreActor(actor: OperationalRestorationActor) {
  return {
    actorId: `${actor.kind}:${actor.householdId}`,
    householdId: actor.householdId,
    capabilities: actor.capabilities,
  };
}

function isAutomationState(
  value: unknown,
): value is AssetAutomationRestorationState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AssetAutomationRestorationState>;
  return (
    typeof candidate.assetId === "string" &&
    typeof candidate.configuredDay === "number" &&
    Array.isArray(candidate.pendingMonths) &&
    Array.isArray(candidate.suspensionIntervals) &&
    Array.isArray(candidate.resumeRevisions)
  );
}

class DefaultAssetOperationalRestorationDriver
  implements AssetOperationalRestorationDriver
{
  private readonly unitOfWork: OperationalRestorationUnitOfWork;
  private readonly automation = createAssetRestorationAutomationParticipant();
  private readonly application;
  private failNextParticipantPreparation: boolean;

  constructor(seed: AssetOperationalRestorationSeed) {
    this.unitOfWork = new OperationalRestorationUnitOfWork(seed);
    this.failNextParticipantPreparation =
      seed.failNextParticipantPreparation ?? false;
    this.application = createAssetLifecycleApplication({
      unitOfWork: this.unitOfWork,
      clock: new FixedClock(),
      ids: new DeterministicIds(),
      hash: new DeterministicHash(),
      restorationParticipant: {
        prepare: (input) => {
          if (this.failNextParticipantPreparation) {
            this.failNextParticipantPreparation = false;
            return {
              kind: "retryable-failure",
              code: "AUTOMATION_RESTORE_PREPARE_RETRYABLE",
            };
          }
          return this.automation.prepare(input);
        },
      },
    });
  }

  async restoreDeletedAsset(
    command: Parameters<
      AssetOperationalRestorationDriver["restoreDeletedAsset"]
    >[0],
  ): Promise<OperationalRestoreResult> {
    const result = await this.application.restoreDeletedAsset({
      ...command,
      actor: coreActor(command.actor),
    });
    if (result.kind !== "success") {
      switch (result.kind) {
        case "forbidden":
        case "validation-error":
        case "not-found":
        case "conflict":
        case "retryable-failure":
          return result;
        default:
          return {
            kind: "conflict",
            code: "INVALID_ASSET_RESTORE_RESULT",
          };
      }
    }

    return {
      kind: "success",
      assetId: result.asset.assetId,
      lifecycle: "active",
      version: result.asset.aggregateVersion,
      ...(result.resumeFromDate === undefined
        ? {}
        : { resumeFromDate: result.resumeFromDate }),
    };
  }

  async listDeletedAssets(query: {
    readonly actor: OperationalRestorationActor;
  }): Promise<OperationalDeletedAssetsResult> {
    const result = await this.application.listDeletedAssets(
      coreActor(query.actor),
    );
    return result.kind === "no-data"
      ? { kind: "success", assetIds: [] }
      : result;
  }

  async listDueMonths(query: {
    readonly actor: OperationalRestorationActor;
    readonly assetId: string;
    readonly asOfDate: string;
  }): Promise<readonly string[]> {
    if (
      !query.actor.capabilities.includes("portfolio.asset.restore.read")
    ) {
      return [];
    }
    const state = await this.unitOfWork.state();
    const asset = state.record.asset;
    if (
      asset === undefined ||
      asset.assetId !== query.assetId ||
      asset.householdId !== query.actor.householdId
    ) {
      return [];
    }
    const result = this.automation.listDueMonths({
      ...(state.participantState === undefined
        ? {}
        : { state: state.participantState }),
      assetLifecycle: asset.lifecycleState,
      asOfDate: query.asOfDate,
    });
    if (result.kind === "validation-error") {
      throw new Error(result.code);
    }
    return result.months;
  }

  async inspectState(): Promise<OperationalRestorationState> {
    const state = await this.unitOfWork.state();
    const asset = state.record.asset;
    return {
      ...(asset === undefined ? {} : { asset: this.toOperationalAsset(asset) }),
      ...(isAutomationState(state.participantState)
        ? { automation: structuredClone(state.participantState) }
        : {}),
    };
  }

  receipts(): readonly AssetLifecycleReceipt[] {
    return this.unitOfWork.receipts();
  }

  recordedEvents(): readonly AssetLifecycleEvent[] {
    return this.unitOfWork.events();
  }

  auditRecords(): readonly AssetLifecycleAuditRecord[] {
    return this.unitOfWork.auditRecords();
  }

  private toOperationalAsset(asset: AssetLifecycleView) {
    return {
      householdId: asset.householdId,
      assetId: asset.assetId,
      lifecycle: asset.lifecycleState,
      version: asset.aggregateVersion,
      ...(asset.deletedAt === undefined ? {} : { deletedOn: asset.deletedAt }),
    };
  }
}

export function createAssetOperationalRestorationDriver(
  seed: AssetOperationalRestorationSeed,
): AssetOperationalRestorationDriver {
  return new DefaultAssetOperationalRestorationDriver(seed);
}
