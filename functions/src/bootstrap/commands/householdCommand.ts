export const HOUSEHOLD_COMMAND_CONTRACT_VERSION = "household-command.v1" as const;

export interface HouseholdCommandEnvelope {
  readonly contractVersion: typeof HOUSEHOLD_COMMAND_CONTRACT_VERSION;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly householdId?: string;
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface HouseholdCommandActor {
  readonly principalUid: string;
  readonly householdId: string;
  readonly actingMemberId: string;
  readonly capabilities: readonly string[];
}

/**
 * Firebase Auth가 검증한 systemAdmin claim을 서버 경계에서 capability로 변환한
 * 관리자 주체입니다. 이 값은 wire payload에서 역직렬화하지 않습니다.
 */
export interface HouseholdAdministratorActor {
  readonly principalRef: string;
  readonly capabilities: readonly (
    | "admin.households.read"
    | "admin.households.write"
    | "admin.household-data.read"
    | "household.delete"
    | "household.restore"
    | "admin.asset-owner-profile.archive"
    | "admin.household-members.remove"
    | "admin.household-members.restore"
    | "portfolio.asset.restore.deleted"
    | "portfolio.asset.restore.read"
  )[];
}

export type HouseholdCommandResult =
  | {
      readonly kind: "success";
      readonly commandId: string;
      readonly data: unknown;
      readonly replayed?: boolean;
    }
  | {
      readonly kind: "error";
      readonly commandId?: string;
      readonly code: HouseholdCommandErrorCode;
      readonly retryable: boolean;
      readonly details?: Readonly<Record<string, unknown>>;
    };

export type HouseholdCommandErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_CONTRACT"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "COMMAND_REQUIRED"
  | "COMMAND_NOT_SUPPORTED"
  | "COMMAND_NOT_AVAILABLE"
  | "COMMAND_ID_REQUIRED"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "HOUSEHOLD_ID_REQUIRED"
  | "HOUSEHOLD_ID_NOT_ALLOWED"
  | "FORBIDDEN_IDENTITY_FIELD"
  | "HOUSEHOLD_FORBIDDEN"
  | "HOUSEHOLD_NOT_ACTIVE"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "COMMAND_IN_PROGRESS"
  | "COMMAND_FAILED";

export interface HouseholdCommandExecutionContext {
  readonly envelope: HouseholdCommandEnvelope;
  readonly principalUid: string;
  readonly actor?: HouseholdCommandActor;
  readonly administrator?: HouseholdAdministratorActor;
  readonly requestedAt: string;
}

export interface HouseholdCommandHandler {
  execute(context: HouseholdCommandExecutionContext): Promise<unknown>;
}

const RECEIPT_VALUE_OVERRIDE = Symbol("household-command-receipt-value");

type ReceiptAwareValue = Readonly<Record<PropertyKey, unknown>> & {
  readonly [RECEIPT_VALUE_OVERRIDE]?: unknown;
};

/**
 * 일회성 secret처럼 응답으로는 한 번만 노출하고 receipt에는 저장하면 안 되는
 * 값이 있을 때 사용합니다. override는 non-enumerable Symbol이므로 wire DTO에
 * 섞이지 않습니다.
 */
export function withHouseholdCommandReceiptValue<T extends object>(
  value: T,
  receiptValue: unknown,
): T {
  Object.defineProperty(value, RECEIPT_VALUE_OVERRIDE, {
    value: receiptValue,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return value;
}

export function householdCommandReceiptValue(value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, RECEIPT_VALUE_OVERRIDE)
  ) {
    return (value as ReceiptAwareValue)[RECEIPT_VALUE_OVERRIDE];
  }
  return value;
}

export class HouseholdCommandRejection extends Error {
  readonly name = "HouseholdCommandRejection";

  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
  }
}
