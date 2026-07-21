import type { HouseholdAdministratorActor } from "../commands/householdCommand";

export const ADMIN_ACCESS_CONTRACT_VERSION = "admin-access.v1" as const;
export const ADMIN_ACCESS_OPERATIONS = Object.freeze([
  "list-households",
  "create-household",
  "get-legacy-share-key",
  "delete-household",
  "restore-household",
  "list-household-members",
  "remove-household-member",
  "restore-household-member",
  "list-deleted-assets",
  "restore-deleted-asset",
] as const);

export type AdminAccessOperation = (typeof ADMIN_ACCESS_OPERATIONS)[number];

export interface AdminAccessEnvelope {
  readonly contractVersion: typeof ADMIN_ACCESS_CONTRACT_VERSION;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly operation: AdminAccessOperation;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type AdminAccessResult =
  | { readonly kind: "success"; readonly requestId: string; readonly data: unknown }
  | {
      readonly kind: "error";
      readonly requestId?: string;
      readonly code: string;
      readonly retryable: boolean;
    };

export interface AdminAccessExecutionContext {
  readonly envelope: AdminAccessEnvelope;
  readonly administrator: HouseholdAdministratorActor;
  readonly requestedAt: string;
}

export interface AdminAccessHandler {
  execute(context: AdminAccessExecutionContext): Promise<unknown>;
}

export class AdminAccessRejection extends Error {
  readonly name = "AdminAccessRejection";

  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
  }
}

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const RESERVED_IDENTITY_FIELDS = new Set([
  "principalUid",
  "principalRef",
  "actor",
  "email",
  "role",
  "capabilities",
  "systemAdmin",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsReservedIdentity(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsReservedIdentity);
  if (!record(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      RESERVED_IDENTITY_FIELDS.has(key) || containsReservedIdentity(nested),
  );
}

function failure(
  code: string,
  requestId?: string,
  retryable = false,
): AdminAccessResult {
  return {
    kind: "error",
    code,
    retryable,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function parseEnvelope(raw: unknown): AdminAccessEnvelope | AdminAccessResult {
  if (!record(raw)) return failure("INVALID_CONTRACT");
  if (raw.contractVersion !== ADMIN_ACCESS_CONTRACT_VERSION) {
    return failure("UNSUPPORTED_CONTRACT_VERSION");
  }
  if (typeof raw.requestId !== "string" || !STABLE_ID.test(raw.requestId)) {
    return failure("REQUEST_ID_REQUIRED");
  }
  const requestId = raw.requestId;
  if (
    typeof raw.idempotencyKey !== "string" ||
    !STABLE_ID.test(raw.idempotencyKey)
  ) {
    return failure("IDEMPOTENCY_KEY_REQUIRED", requestId);
  }
  if (
    typeof raw.operation !== "string" ||
    !(ADMIN_ACCESS_OPERATIONS as readonly string[]).includes(raw.operation)
  ) {
    return failure("OPERATION_NOT_AVAILABLE", requestId);
  }
  if (!record(raw.payload)) return failure("INVALID_CONTRACT", requestId);
  if (containsReservedIdentity(raw.payload)) {
    return failure("FORBIDDEN_IDENTITY_FIELD", requestId);
  }
  const allowed = new Set([
    "contractVersion",
    "requestId",
    "idempotencyKey",
    "operation",
    "payload",
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    return failure("INVALID_CONTRACT", requestId);
  }
  return {
    contractVersion: ADMIN_ACCESS_CONTRACT_VERSION,
    requestId,
    idempotencyKey: raw.idempotencyKey,
    operation: raw.operation as AdminAccessOperation,
    payload: raw.payload,
  };
}

export function createAdminAccessRouter(input: {
  readonly handlers: ReadonlyMap<AdminAccessOperation, AdminAccessHandler>;
}) {
  return {
    async execute(request: {
      readonly principalUid: string | undefined;
      readonly administrator: HouseholdAdministratorActor | undefined;
      readonly request: unknown;
      readonly requestedAt: string;
    }): Promise<AdminAccessResult> {
      if (
        request.principalUid === undefined ||
        request.principalUid.trim() === ""
      ) {
        return failure("AUTH_REQUIRED");
      }
      const parsed = parseEnvelope(request.request);
      if ("kind" in parsed) return parsed;
      if (
        request.administrator === undefined ||
        request.administrator.principalRef !== request.principalUid.trim()
      ) {
        return failure("ADMIN_CAPABILITY_REQUIRED", parsed.requestId);
      }
      const handler = input.handlers.get(parsed.operation);
      if (handler === undefined) {
        return failure("OPERATION_NOT_AVAILABLE", parsed.requestId);
      }
      try {
        return {
          kind: "success",
          requestId: parsed.requestId,
          data: await handler.execute({
            envelope: parsed,
            administrator: request.administrator,
            requestedAt: request.requestedAt,
          }),
        };
      } catch (caught) {
        return caught instanceof AdminAccessRejection
          ? failure(caught.code, parsed.requestId, caught.retryable)
          : failure("ADMIN_ACCESS_FAILED", parsed.requestId, true);
      }
    },
  };
}
