export type CanonicalAssetLifecycle = "active" | "deleted" | "purging";

export interface AssetLifecycleView {
  readonly assetId: string;
  readonly householdId: string;
  readonly lifecycleState: CanonicalAssetLifecycle;
  readonly aggregateVersion: number;
  readonly deletedAt?: string;
}

export type AssetPurgeParticipant = "holdings" | "automation" | "core";

export interface AssetPurgeParticipantProgress {
  readonly status: "pending" | "in-progress" | "completed";
  readonly checkpoint?: string;
}

export interface AssetPurgeProcessView {
  readonly processId: string;
  readonly assetId: string;
  readonly confirmationRefHash: string;
  readonly status: "in-progress";
  readonly participants: Readonly<
    Record<AssetPurgeParticipant, AssetPurgeParticipantProgress>
  >;
}

export interface AssetPurgeCompletionView {
  readonly processId: string;
  readonly completed: true;
  readonly completedAt: string;
  readonly resultHash: string;
}

export type AssetLifecycleOperation =
  | "delete"
  | "restore"
  | "purge-request"
  | "purge-page";

export interface AssetLifecycleReceipt {
  readonly commandId: string;
  readonly assetId: string;
  readonly operation: AssetLifecycleOperation;
  readonly resultingVersion: number;
}

export type AssetLifecycleAuditRecord =
  | {
      readonly commandId: string;
      readonly actorId: string;
      readonly assetId: string;
      readonly operation: "restore";
      readonly reason: string;
    }
  | {
      readonly commandId: string;
      readonly actorId: string;
      readonly assetId: string;
      readonly operation: "purge-request";
      readonly confirmationRefHash: string;
    };

export type AssetLifecycleEvent = {
  readonly eventType: "AssetLifecycleChanged.v1";
  readonly assetId: string;
  readonly before: "active" | "deleted";
  readonly after: "active" | "deleted";
  readonly aggregateVersion: number;
  readonly resumeFromDate?: string;
};

export type AssetLifecycleCommandResult =
  | {
      readonly kind: "success";
      readonly asset: AssetLifecycleView;
      readonly receipt: AssetLifecycleReceipt;
      readonly resumeFromDate?: string;
    }
  | {
      readonly kind: "purge-requested";
      readonly asset: AssetLifecycleView;
      readonly process: AssetPurgeProcessView;
      readonly receipt: AssetLifecycleReceipt;
    }
  | {
      readonly kind: "purge-page-processed";
      readonly process: AssetPurgeProcessView;
      readonly receipt: AssetLifecycleReceipt;
    }
  | {
      readonly kind: "purge-completed";
      readonly completion: AssetPurgeCompletionView;
      readonly receipt: AssetLifecycleReceipt;
    }
  | { readonly kind: "forbidden"; readonly code: string }
  | { readonly kind: "validation-error"; readonly code: string }
  | { readonly kind: "not-found"; readonly code: "ASSET_NOT_FOUND" }
  | { readonly kind: "conflict"; readonly code: string }
  | {
      readonly kind: "retryable-failure";
      readonly code: string;
      readonly checkpoint?: string;
    };

export interface AssetLifecycleActor {
  readonly actorId: string;
  readonly householdId: string;
  readonly capabilities: readonly string[];
}

export interface DeleteAssetCommand {
  readonly actor: AssetLifecycleActor;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly assetId: string;
  readonly expectedVersion: number;
}

export interface RestoreDeletedAssetCommand {
  readonly actor: AssetLifecycleActor;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly assetId: string;
  readonly expectedVersion: number;
  /** 운영 Adapter가 서버의 업무 날짜로 정규화한 복구일입니다. */
  readonly restoredOn: string;
  readonly auditReason: string;
}

export interface RequestPermanentAssetPurgeCommand {
  readonly actor: AssetLifecycleActor;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly assetId: string;
  readonly expectedVersion: number;
  readonly confirmationRef: string;
}

export type AssetPurgePageOutcome =
  | {
      readonly kind: "page-processed";
      readonly checkpoint: string;
    }
  | {
      readonly kind: "participant-completed";
      readonly finalCheckpoint: string;
    }
  | {
      readonly kind: "retryable-failure";
      readonly code: string;
      readonly checkpoint: string;
    };

export interface ApplyPermanentAssetPurgePageCommand {
  readonly actor: AssetLifecycleActor;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly assetId: string;
  readonly processId: string;
  readonly participant: AssetPurgeParticipant;
  readonly cursor?: string;
  readonly limit: number;
  readonly pageOutcome: AssetPurgePageOutcome;
}

export interface AssetLifecycleRecord {
  readonly asset?: AssetLifecycleView;
  readonly purgeProcess?: AssetPurgeProcessView;
  readonly purgeCompletion?: AssetPurgeCompletionView;
  readonly commandReceipts: Readonly<
    Record<
      string,
      {
        readonly payloadFingerprint: string;
        readonly result: AssetLifecycleCommandResult;
      }
    >
  >;
}

export type AssetLifecycleDecision =
  | { readonly kind: "return"; readonly result: AssetLifecycleCommandResult }
  | {
      readonly kind: "commit";
      readonly nextRecord: AssetLifecycleRecord;
      readonly receipt: AssetLifecycleReceipt;
      readonly events: readonly AssetLifecycleEvent[];
      readonly auditRecords?: readonly AssetLifecycleAuditRecord[];
      readonly result: AssetLifecycleCommandResult;
    };

export function lifecyclePayloadFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

export function validateRequiredText(
  value: string,
  code: string,
): { kind: "valid"; value: string } | { kind: "invalid"; code: string } {
  const normalized = value.trim();
  return normalized === ""
    ? { kind: "invalid", code }
    : { kind: "valid", value: normalized };
}

export function nextLifecycleAsset(
  asset: AssetLifecycleView,
  lifecycleState: CanonicalAssetLifecycle,
  deletedAt?: string,
): AssetLifecycleView {
  return {
    assetId: asset.assetId,
    householdId: asset.householdId,
    lifecycleState,
    aggregateVersion: asset.aggregateVersion + 1,
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

export function mapLegacyAssetLifecycle(input: {
  readonly asset: AssetLifecycleView;
  readonly legacyIsActive?: boolean;
}): AssetLifecycleView {
  if (
    input.legacyIsActive === false &&
    input.asset.lifecycleState === "active"
  ) {
    return {
      ...input.asset,
      lifecycleState: "deleted",
    };
  }
  return { ...input.asset };
}

export function initialPurgeParticipants(): Readonly<
  Record<AssetPurgeParticipant, AssetPurgeParticipantProgress>
> {
  return {
    holdings: { status: "pending" },
    automation: { status: "pending" },
    core: { status: "pending" },
  };
}
