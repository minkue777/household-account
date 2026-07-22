import type {
  HouseholdAdministratorActor,
  HouseholdCommandEnvelope,
  HouseholdCommandHandler,
  HouseholdCommandResult,
} from "./householdCommand";
import {
  HOUSEHOLD_COMMAND_CONTRACT_VERSION,
  householdCommandReceiptValue,
  HouseholdCommandRejection,
} from "./householdCommand";
import type {
  HouseholdCommandHashPort,
  HouseholdCommandMembershipPort,
  HouseholdCommandReceiptPort,
} from "./householdCommandPorts";

const TENANTLESS_COMMANDS = new Set([
  "access.resolve-signed-in-user.v1",
  "access.claim-legacy-membership.v1",
  "access.create-household-with-self.v1",
  "access.join-household-as-self.v1",
]);

/**
 * 인증된 현재 상태를 조회하기만 하는 명령은 멱등 receipt를 만들지 않습니다.
 *
 * 이 조회는 매 앱 시작마다 새로운 commandId로 호출되므로 receipt가 재실행을
 * 막아 주지 못하고, 오히려 Firestore claim/complete 왕복만 추가합니다. 쓰기
 * 명령은 계속 아래의 공통 receipt 경계를 통과합니다.
 */
const RECEIPTLESS_READ_COMMANDS = new Set([
  "access.resolve-signed-in-user.v1",
]);

const ADMINISTRATOR_COMMANDS = new Set([
  "access.archive-asset-owner-profile.v1",
]);

const RESERVED_IDENTITY_FIELDS = new Set([
  "principalUid",
  "actingMemberId",
  "actor",
  "role",
  "capabilities",
]);

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const COMMAND_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\.v[1-9][0-9]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength = 160): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function stableId(value: unknown): value is string {
  return nonEmptyString(value, 160) && STABLE_ID_PATTERN.test(value);
}

function containsReservedIdentityField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsReservedIdentityField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      RESERVED_IDENTITY_FIELDS.has(key) || containsReservedIdentityField(nested),
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (!isRecord(value)) return JSON.stringify(value) ?? "null";
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function error(
  code: Extract<HouseholdCommandResult, { kind: "error" }> ["code"],
  input: { commandId?: string; retryable?: boolean; details?: Record<string, unknown> } = {},
): HouseholdCommandResult {
  return {
    kind: "error",
    code,
    retryable: input.retryable ?? false,
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

function parseEnvelope(raw: unknown): HouseholdCommandEnvelope | HouseholdCommandResult {
  if (!isRecord(raw)) return error("INVALID_CONTRACT");
  if (raw.contractVersion !== HOUSEHOLD_COMMAND_CONTRACT_VERSION) {
    return error("UNSUPPORTED_CONTRACT_VERSION");
  }
  if (!stableId(raw.commandId)) return error("COMMAND_ID_REQUIRED");
  if (!stableId(raw.idempotencyKey)) {
    return error("IDEMPOTENCY_KEY_REQUIRED", { commandId: raw.commandId.trim() });
  }
  if (!nonEmptyString(raw.command, 120) || !COMMAND_PATTERN.test(raw.command)) {
    return error("COMMAND_REQUIRED", { commandId: raw.commandId.trim() });
  }
  if (!isRecord(raw.payload)) {
    return error("INVALID_CONTRACT", { commandId: raw.commandId.trim() });
  }
  if (
    raw.householdId !== undefined &&
    !stableId(raw.householdId)
  ) {
    return error("INVALID_CONTRACT", { commandId: raw.commandId.trim() });
  }
  if (containsReservedIdentityField(raw.payload)) {
    return error("FORBIDDEN_IDENTITY_FIELD", {
      commandId: raw.commandId.trim(),
    });
  }

  const allowedFields = new Set([
    "contractVersion",
    "commandId",
    "idempotencyKey",
    "householdId",
    "command",
    "payload",
  ]);
  if (Object.keys(raw).some((key) => !allowedFields.has(key))) {
    return error("INVALID_CONTRACT", { commandId: raw.commandId.trim() });
  }

  return {
    contractVersion: HOUSEHOLD_COMMAND_CONTRACT_VERSION,
    commandId: raw.commandId.trim(),
    idempotencyKey: raw.idempotencyKey.trim(),
    command: raw.command.trim(),
    payload: raw.payload,
    ...(raw.householdId === undefined
      ? {}
      : { householdId: raw.householdId.trim() }),
  };
}

export interface HouseholdCommandRouter {
  execute(input: {
    readonly principalUid: string | undefined;
    readonly request: unknown;
    readonly requestedAt: string;
    readonly administrator?: HouseholdAdministratorActor;
  }): Promise<HouseholdCommandResult>;
}

export function createHouseholdCommandRouter(input: {
  readonly handlers: ReadonlyMap<string, HouseholdCommandHandler>;
  readonly memberships: HouseholdCommandMembershipPort;
  readonly receipts: HouseholdCommandReceiptPort;
  readonly hashes: HouseholdCommandHashPort;
}): HouseholdCommandRouter {
  return {
    async execute(request) {
      if (!nonEmptyString(request.principalUid, 256)) {
        return error("AUTH_REQUIRED");
      }
      const parsed = parseEnvelope(request.request);
      if ("kind" in parsed) return parsed;

      const tenantless = TENANTLESS_COMMANDS.has(parsed.command);
      if (tenantless && parsed.householdId !== undefined) {
        return error("HOUSEHOLD_ID_NOT_ALLOWED", {
          commandId: parsed.commandId,
        });
      }
      if (!tenantless && parsed.householdId === undefined) {
        return error("HOUSEHOLD_ID_REQUIRED", { commandId: parsed.commandId });
      }

      const handler = input.handlers.get(parsed.command);
      if (handler === undefined) {
        return error("COMMAND_NOT_AVAILABLE", { commandId: parsed.commandId });
      }

      const requiresAdministrator = ADMINISTRATOR_COMMANDS.has(parsed.command);
      if (
        requiresAdministrator &&
        (request.administrator === undefined ||
          request.administrator.principalRef !== request.principalUid.trim())
      ) {
        return error("HOUSEHOLD_FORBIDDEN", { commandId: parsed.commandId });
      }

      const actor =
        parsed.householdId === undefined || requiresAdministrator
          ? undefined
          : await input.memberships.resolveActor({
              principalUid: request.principalUid.trim(),
              householdId: parsed.householdId,
            });
      if (actor?.kind === "forbidden") {
        return error("HOUSEHOLD_FORBIDDEN", { commandId: parsed.commandId });
      }
      if (actor?.kind === "household-not-active") {
        return error("HOUSEHOLD_NOT_ACTIVE", { commandId: parsed.commandId });
      }

      if (RECEIPTLESS_READ_COMMANDS.has(parsed.command)) {
        try {
          const data = await handler.execute({
            envelope: parsed,
            principalUid: request.principalUid.trim(),
            requestedAt: request.requestedAt,
          });
          return {
            kind: "success",
            commandId: parsed.commandId,
            data,
          };
        } catch (caught) {
          if (caught instanceof HouseholdCommandRejection) {
            return error("COMMAND_FAILED", {
              commandId: parsed.commandId,
              retryable: caught.retryable,
              details: { domainCode: caught.code },
            });
          }
          return error("COMMAND_FAILED", {
            commandId: parsed.commandId,
            retryable: true,
          });
        }
      }

      const payloadHash = input.hashes.hash(canonicalJson(parsed));
      const receiptId = input.hashes.hash(
        `${request.principalUid.trim()}\u0000${parsed.idempotencyKey}`,
      );
      const claim = await input.receipts.claim({
        receiptId,
        principalUid: request.principalUid.trim(),
        command: parsed.command,
        payloadHash,
        requestedAt: request.requestedAt,
      });
      if (claim.kind === "payload-mismatch") {
        return error("IDEMPOTENCY_PAYLOAD_MISMATCH", {
          commandId: parsed.commandId,
        });
      }
      if (claim.kind === "in-progress") {
        return error("COMMAND_IN_PROGRESS", {
          commandId: parsed.commandId,
          retryable: true,
        });
      }
      if (claim.kind === "completed") {
        return claim.result.kind === "success"
          ? { ...claim.result, replayed: true }
          : claim.result;
      }

      try {
        const data = await handler.execute({
          envelope: parsed,
          principalUid: request.principalUid.trim(),
          ...(actor?.kind === "active" ? { actor: actor.actor } : {}),
          ...(requiresAdministrator && request.administrator !== undefined
            ? { administrator: request.administrator }
            : {}),
          requestedAt: request.requestedAt,
        });
        const result: HouseholdCommandResult = {
          kind: "success",
          commandId: parsed.commandId,
          data,
        };
        await input.receipts.complete({
          receiptId,
          payloadHash,
          result: {
            ...result,
            data: householdCommandReceiptValue(data),
          },
          completedAt: request.requestedAt,
        });
        return result;
      } catch (caught) {
        if (caught instanceof HouseholdCommandRejection) {
          const result = error("COMMAND_FAILED", {
            commandId: parsed.commandId,
            retryable: caught.retryable,
            details: { domainCode: caught.code },
          });
          if (caught.retryable) {
            await input.receipts.abandon({ receiptId, payloadHash });
            return result;
          }
          await input.receipts.complete({
            receiptId,
            payloadHash,
            result,
            completedAt: request.requestedAt,
          });
          return result;
        }
        await input.receipts.abandon({ receiptId, payloadHash });
        return error("COMMAND_FAILED", {
          commandId: parsed.commandId,
          retryable: true,
        });
      }
    },
  };
}

export const householdCommandTenantlessAllowlist = Object.freeze([
  ...TENANTLESS_COMMANDS,
]);

export const householdCommandAdministratorAllowlist = Object.freeze([
  ...ADMINISTRATOR_COMMANDS,
]);
