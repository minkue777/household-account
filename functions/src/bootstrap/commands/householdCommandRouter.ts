import type {
  HouseholdAdministratorActor,
  HouseholdCommandEnvelope,
  HouseholdCommandHandler,
  HouseholdCommandResult,
} from "./householdCommand";
import { canonicalJson } from '../../platform/shared-kernel/canonicalJson';
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
import {
  measureCurrentInteractiveLatency,
  setCurrentInteractiveLatencyOperation,
} from "../../observability/interactiveLatency";

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

function error(
  code: Extract<HouseholdCommandResult, { kind: "error" }> ["code"],
  input: { commandId?: string; retryable?: boolean; details?: Record<string, unknown> } = {},
): Extract<HouseholdCommandResult, { kind: "error" }> {
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
      const principalUid = request.principalUid.trim();
      const parsed = parseEnvelope(request.request);
      if ("kind" in parsed) return parsed;

      const handler = input.handlers.get(parsed.command);
      const tenantless = handler?.access === "signed-in-user";
      if (tenantless && parsed.householdId !== undefined) {
        return error("HOUSEHOLD_ID_NOT_ALLOWED", {
          commandId: parsed.commandId,
        });
      }
      if (!tenantless && parsed.householdId === undefined) {
        return error("HOUSEHOLD_ID_REQUIRED", { commandId: parsed.commandId });
      }

      if (handler === undefined) {
        return error("COMMAND_NOT_AVAILABLE", { commandId: parsed.commandId });
      }
      setCurrentInteractiveLatencyOperation(parsed.command);

      const requiresAdministrator = handler.access === "administrator";
      if (
        requiresAdministrator &&
        (request.administrator === undefined ||
          request.administrator.principalRef !== principalUid)
      ) {
        return error("HOUSEHOLD_FORBIDDEN", { commandId: parsed.commandId });
      }

      const householdId = parsed.householdId;
      const actor =
        householdId === undefined || requiresAdministrator
          ? undefined
          : await measureCurrentInteractiveLatency(
              "actor-membership",
              () =>
                input.memberships.resolveActor({
                  principalUid,
                  householdId,
                }),
            );
      if (actor?.kind === "forbidden") {
        return error("HOUSEHOLD_FORBIDDEN", { commandId: parsed.commandId });
      }
      if (actor?.kind === "household-not-active") {
        return error("HOUSEHOLD_NOT_ACTIVE", { commandId: parsed.commandId });
      }

      const domainOwnsReceipt =
        handler.idempotencyBoundary === "domain-idempotency-key" ||
        (handler.idempotencyBoundary === "domain-command-id" &&
          parsed.commandId === parsed.idempotencyKey);
      let receipt: { receiptId: string; payloadHash: string } | undefined;
      if (handler.idempotencyBoundary !== "read-only" && !domainOwnsReceipt) {
        const payloadHash = input.hashes.hash(canonicalJson({
          contractVersion: parsed.contractVersion,
          command: parsed.command,
          householdId: parsed.householdId,
          payload: parsed.payload,
        }));
        const receiptId = input.hashes.hash(
          `${principalUid}\u0000${parsed.idempotencyKey}`,
        );
        const claim = await measureCurrentInteractiveLatency(
          "command-receipt-claim",
          () =>
            input.receipts.claim({
              receiptId,
              principalUid,
              command: parsed.command,
              payloadHash,
              legacyEnvelope: parsed,
              ...(householdId === undefined ? {} : { householdId }),
              requestedAt: request.requestedAt,
            }),
        );
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
            ? { ...claim.result, commandId: parsed.commandId, replayed: true }
            : { ...claim.result, commandId: parsed.commandId };
        }

        receipt = { receiptId, payloadHash };
      }

      try {
        const data = await measureCurrentInteractiveLatency("handler", () =>
          handler.execute({
            envelope: parsed,
            principalUid,
            ...(actor?.kind === "active" ? { actor: actor.actor } : {}),
            ...(requiresAdministrator && request.administrator !== undefined
              ? { administrator: request.administrator }
              : {}),
            requestedAt: request.requestedAt,
          }),
        );
        const result: HouseholdCommandResult = {
          kind: "success",
          commandId: parsed.commandId,
          data,
        };
        if (receipt) {
          await measureCurrentInteractiveLatency(
            "command-receipt-complete",
            () =>
              input.receipts.complete({
                receiptId: receipt.receiptId,
                payloadHash: receipt.payloadHash,
                result: {
                  ...result,
                  data: householdCommandReceiptValue(data),
                },
                completedAt: request.requestedAt,
              }),
          );
        }
        return result;
      } catch (caught) {
        const rejection = caught instanceof HouseholdCommandRejection ? caught : undefined;
        const result = error("COMMAND_FAILED", {
          commandId: parsed.commandId,
          retryable: rejection?.retryable ?? true,
          ...(rejection ? { details: { domainCode: rejection.code } } : {}),
        });
        if (receipt) {
          if (result.retryable) {
            await measureCurrentInteractiveLatency("command-receipt-abandon", () => input.receipts.abandon(receipt));
          } else {
            await measureCurrentInteractiveLatency("command-receipt-complete", () => input.receipts.complete({
              ...receipt, result, completedAt: request.requestedAt,
            }));
          }
        }
        return result;
      }
    },
  };
}
