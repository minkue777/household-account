import type { ShortcutValueNormalizerInputPort } from "../../../application/ports/in/shortcutValueNormalizerInputPort";
import type { ShortcutHttpRequestProcessorInputPort } from "../../../application/ports/in/shortcutHttpRequestProcessorInputPort";
import type { ShortcutHttpRequestProcessingResult } from "../../../domain/model/shortcutHttpInbound";
import type { ShortcutHttpIngressGatePort } from "../../../application/ports/out/shortcutHttpInboundPorts";

export type { ShortcutHttpIngressGatePort } from "../../../application/ports/out/shortcutHttpInboundPorts";

export interface ShortcutHttpIngressLimits {
  readonly maxBodyBytes: number;
  readonly maxMessageChars: number;
  readonly maxIdempotencyKeyChars: number;
}

export interface ShortcutHttpInboundRequest {
  readonly method: "POST" | "OPTIONS" | "GET" | "PUT" | "DELETE";
  readonly headers: {
    readonly authorization?: string;
    readonly contentType?: string;
    readonly idempotencyKey?: string;
    readonly origin?: string;
  };
  readonly rawBodyBytes: number;
  readonly body: unknown;
  readonly receivedAt: string;
  readonly remoteAddress: string;
}

export type ShortcutHttpInboundErrorCode =
  | "INVALID_CONTRACT"
  | "REQUIRED_FIELD"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "METHOD_NOT_ALLOWED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "FIELD_TOO_LONG"
  | "ORIGIN_NOT_ALLOWED"
  | "AUTH_REQUIRED"
  | "CREDENTIAL_REVOKED"
  | "CREDENTIAL_REPLACED"
  | "CREDENTIAL_KEY_VERSION_INVALID"
  | "HOUSEHOLD_FORBIDDEN"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "UNSUPPORTED_MESSAGE"
  | "CARD_NOT_REGISTERED_FOR_ACTOR"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "PAYMENT_INTAKE_TEMPORARILY_UNAVAILABLE";

export type ShortcutHttpInboundResponse =
  | {
      readonly status: 200;
      readonly body: {
        readonly contractVersion: "shortcut-payment-response.v1";
        readonly commandId: string;
        readonly transaction: Extract<
          ShortcutHttpRequestProcessingResult,
          { kind: "success" }
        >["transaction"];
        readonly notification: Extract<
          ShortcutHttpRequestProcessingResult,
          { kind: "success" }
        >["notification"];
      };
    }
  | { readonly status: 204; readonly body: null }
  | {
      readonly status: 400 | 401 | 403 | 405 | 409 | 413 | 415 | 422 | 429 | 503;
      readonly body: {
        readonly contractVersion: "shortcut-payment-response.v1";
        readonly error: {
          readonly code: ShortcutHttpInboundErrorCode;
          readonly retryable: boolean;
        };
      };
    };

export interface ShortcutHttpInboundHandler {
  handle(request: ShortcutHttpInboundRequest): Promise<ShortcutHttpInboundResponse>;
}

function errorResponse(
  status: Exclude<ShortcutHttpInboundResponse, { status: 200 | 204 }>["status"],
  code: ShortcutHttpInboundErrorCode,
  retryable = false,
): ShortcutHttpInboundResponse {
  return {
    status,
    body: {
      contractVersion: "shortcut-payment-response.v1",
      error: { code, retryable },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContentType(value: string | undefined): boolean {
  return value?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

function bearerValue(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/u);
  return match?.[1] ?? null;
}

function validateLimits(limits: ShortcutHttpIngressLimits): void {
  for (const name of [
    "maxBodyBytes",
    "maxMessageChars",
    "maxIdempotencyKeyChars",
  ] as const) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid Shortcut ingress limit: ${name}`);
    }
  }
}

const COMPATIBILITY_FIELDS = new Set([
  "contractVersion",
  "message",
  "householdId",
  "createdBy",
  "memberName",
  "deviceOwner",
  "owner",
]);

function processingStatus(
  result: Extract<ShortcutHttpRequestProcessingResult, { kind: "error" }>,
): 401 | 403 | 409 | 422 | 429 | 503 {
  switch (result.code) {
    case "AUTH_REQUIRED":
    case "CREDENTIAL_REVOKED":
    case "CREDENTIAL_REPLACED":
    case "CREDENTIAL_KEY_VERSION_INVALID":
      return 401;
    case "HOUSEHOLD_FORBIDDEN":
      return 403;
    case "IDEMPOTENCY_PAYLOAD_MISMATCH":
      return 409;
    case "RATE_LIMITED":
    case "QUOTA_EXCEEDED":
      return 429;
    case "PAYMENT_INTAKE_TEMPORARILY_UNAVAILABLE":
      return 503;
    default:
      return 422;
  }
}

export function createShortcutHttpInboundHandler(input: {
  readonly limits: ShortcutHttpIngressLimits;
  readonly normalizer: ShortcutValueNormalizerInputPort;
  readonly processor: ShortcutHttpRequestProcessorInputPort;
  readonly ingressGate: ShortcutHttpIngressGatePort;
}): ShortcutHttpInboundHandler {
  validateLimits(input.limits);

  return {
    async handle(request) {
      if (request.method === "OPTIONS") return { status: 204, body: null };
      if (request.method !== "POST") {
        return errorResponse(405, "METHOD_NOT_ALLOWED");
      }
      if (!isJsonContentType(request.headers.contentType)) {
        return errorResponse(415, "UNSUPPORTED_MEDIA_TYPE");
      }
      if (
        !Number.isSafeInteger(request.rawBodyBytes) ||
        request.rawBodyBytes < 0
      ) {
        return errorResponse(400, "INVALID_CONTRACT");
      }
      if (request.rawBodyBytes > input.limits.maxBodyBytes) {
        return errorResponse(413, "PAYLOAD_TOO_LARGE");
      }
      if (!isRecord(request.body)) {
        return errorResponse(400, "INVALID_CONTRACT");
      }
      if (!("contractVersion" in request.body)) {
        return errorResponse(400, "REQUIRED_FIELD");
      }
      if (request.body.contractVersion !== "shortcut-payment.v1") {
        return errorResponse(400, "UNSUPPORTED_CONTRACT_VERSION");
      }
      if (!("message" in request.body)) {
        return errorResponse(400, "REQUIRED_FIELD");
      }
      if (Object.keys(request.body).some((key) => !COMPATIBILITY_FIELDS.has(key))) {
        return errorResponse(400, "INVALID_CONTRACT");
      }

      const rawMessage = request.body.message;
      const rawIdempotencyKey = request.headers.idempotencyKey;
      if (
        (typeof rawMessage === "string" &&
          rawMessage.length > input.limits.maxMessageChars) ||
        (rawIdempotencyKey?.length ?? 0) >
          input.limits.maxIdempotencyKeyChars
      ) {
        return errorResponse(400, "FIELD_TOO_LONG");
      }

      const normalized = input.normalizer.normalize(rawMessage);
      if (normalized.kind === "Empty") {
        return errorResponse(400, "REQUIRED_FIELD");
      }
      const idempotencyKey = rawIdempotencyKey?.trim();
      if (
        normalized.value.length > input.limits.maxMessageChars ||
        (idempotencyKey?.length ?? 0) > input.limits.maxIdempotencyKeyChars
      ) {
        return errorResponse(400, "FIELD_TOO_LONG");
      }

      const gate = await input.ingressGate.evaluateIp(request.remoteAddress);
      if (gate.kind === "rate-limited") {
        return errorResponse(429, "RATE_LIMITED", true);
      }
      if (gate.kind === "quota-exceeded") {
        return errorResponse(429, "QUOTA_EXCEEDED", true);
      }

      const processed = await input.processor.process({
        bearerCredential: bearerValue(request.headers.authorization),
        normalizedMessage: normalized.value,
        requestedAt: request.receivedAt,
        ...(idempotencyKey === undefined || idempotencyKey === ""
          ? {}
          : { idempotencyKey }),
      });
      if (processed.kind === "error") {
        return errorResponse(
          processingStatus(processed),
          processed.code,
          processed.retryable,
        );
      }
      return {
        status: 200,
        body: {
          contractVersion: "shortcut-payment-response.v1",
          commandId: processed.commandId,
          transaction: processed.transaction,
          notification: processed.notification,
        },
      };
    },
  };
}
