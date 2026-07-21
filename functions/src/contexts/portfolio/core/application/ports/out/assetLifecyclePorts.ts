import type {
  AssetLifecycleCommandResult,
  AssetLifecycleDecision,
  AssetLifecycleAuditRecord,
  AssetLifecycleEvent,
  AssetLifecycleRecord,
  AssetLifecycleReceipt,
} from "../../../domain/model/assetLifecycle";

export interface AssetRestorationParticipantSnapshot {
  readonly lifecycleRecord: AssetLifecycleRecord;
  readonly participantState?: unknown;
}

export type AssetRestorationParticipantResult =
  | {
      readonly kind: "prepared";
      readonly nextState?: unknown;
      readonly resumeFromDate?: string;
    }
  | { readonly kind: "validation-error"; readonly code: string }
  | { readonly kind: "retryable-failure"; readonly code: string };

/**
 * Automation은 이 Port를 구현해 계산만 반환합니다. 직접 commit하지 않으며,
 * Core Workflow의 UoW가 Asset 전환과 participant 상태를 함께 저장합니다.
 */
export interface AssetRestorationParticipantPort {
  prepare(input: {
    readonly assetId: string;
    readonly householdId: string;
    readonly deletedAt?: string;
    readonly restoredOn: string;
    readonly state?: unknown;
  }): AssetRestorationParticipantResult;
}

export type AssetRestorationWorkflowDecision =
  | { readonly kind: "return"; readonly result: AssetLifecycleCommandResult }
  | {
      readonly kind: "commit";
      readonly nextLifecycleRecord: AssetLifecycleRecord;
      readonly nextParticipantState?: unknown;
      readonly receipt: AssetLifecycleReceipt;
      readonly events: readonly AssetLifecycleEvent[];
      readonly auditRecords: readonly AssetLifecycleAuditRecord[];
      readonly result: AssetLifecycleCommandResult;
    };

export interface AssetLifecycleUnitOfWorkPort {
  transact(
    assetId: string,
    decide: (record: AssetLifecycleRecord) => AssetLifecycleDecision,
  ): Promise<AssetLifecycleCommandResult>;
  transactRestoration(
    assetId: string,
    decide: (
      snapshot: AssetRestorationParticipantSnapshot,
    ) => AssetRestorationWorkflowDecision,
  ): Promise<AssetLifecycleCommandResult>;
  read(assetId: string): Promise<AssetLifecycleRecord | undefined>;
  listByHousehold(householdId: string): Promise<readonly AssetLifecycleRecord[]>;
  receipts(): readonly AssetLifecycleReceipt[];
  events(): readonly AssetLifecycleEvent[];
  auditRecords(): readonly AssetLifecycleAuditRecord[];
}

export interface AssetLifecycleClockPort {
  now(): string;
}

export interface AssetLifecycleIdPort {
  purgeProcessId(idempotencyKey: string): string;
}

export interface AssetLifecycleHashPort {
  hash(value: string): string;
}
