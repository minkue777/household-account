import * as functions from "firebase-functions/v1";

import {
  FirebaseShortcutCaptureIntakeAdapter,
  FirebaseShortcutHttpCredentialAuthorizationAdapter,
  FirebaseShortcutHttpReceiptAdapter,
  FirebaseShortcutIngressGateAdapter,
  Sha256ShortcutHttpHashAdapter,
} from "../adapters/firebase/payment-capture/firebaseShortcutHttpInfrastructure";
import { HmacShortcutCredentialSecretAdapter } from "../adapters/firebase/payment-capture/firebaseShortcutCredentialInfrastructure";
import { createShortcutHttpRequestProcessorApplication } from "../contexts/payment-capture/shortcut-ingestion/application/shortcutHttpRequestProcessorApplication";
import {
  createShortcutCardMessageParser,
  createShortcutValueNormalizer,
} from "../contexts/payment-capture/shortcut-ingestion/public";
import {
  createShortcutHttpInboundHandler,
  type ShortcutHttpInboundRequest,
} from "../contexts/payment-capture/shortcut-ingestion/adapters/in/http/shortcutHttpInboundHandler";
import { db, REGION } from "../config";
import { createFirebaseCaptureSubmissionPort } from "./firebaseCaptureSubmission";
import { createFirebaseShortcutCredentialLifecycle } from "./commands/shortcutCredentialHouseholdCommandHandlers";

function configuredPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer configuration: ${name}`);
  }
  return parsed;
}

function allowedOrigins(): ReadonlySet<string> {
  return new Set(
    (process.env.SHORTCUT_CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => /^https:\/\//u.test(origin) && origin !== "*"),
  );
}

const lifecycle = createFirebaseShortcutCredentialLifecycle(db);
const gate = new FirebaseShortcutIngressGateAdapter(db, {
  maxIpRequestsPerMinute: configuredPositiveInteger(
    "SHORTCUT_IP_REQUESTS_PER_MINUTE",
    60,
  ),
  maxCredentialRequestsPerMinute: configuredPositiveInteger(
    "SHORTCUT_CREDENTIAL_REQUESTS_PER_MINUTE",
    30,
  ),
  maxCredentialRequestsPerDay: configuredPositiveInteger(
    "SHORTCUT_CREDENTIAL_REQUESTS_PER_DAY",
    500,
  ),
});
const inbound = createShortcutHttpInboundHandler({
  limits: {
    maxBodyBytes: configuredPositiveInteger("SHORTCUT_MAX_BODY_BYTES", 16_384),
    maxMessageChars: configuredPositiveInteger(
      "SHORTCUT_MAX_MESSAGE_CHARS",
      4_096,
    ),
    maxIdempotencyKeyChars: configuredPositiveInteger(
      "SHORTCUT_MAX_IDEMPOTENCY_KEY_CHARS",
      160,
    ),
  },
  normalizer: createShortcutValueNormalizer(),
  ingressGate: gate,
  processor: createShortcutHttpRequestProcessorApplication({
    credentials: new FirebaseShortcutHttpCredentialAuthorizationAdapter(
      lifecycle,
    ),
    credentialGate: gate,
    parser: createShortcutCardMessageParser(),
    intake: new FirebaseShortcutCaptureIntakeAdapter(
      createFirebaseCaptureSubmissionPort(),
    ),
    receipts: new FirebaseShortcutHttpReceiptAdapter(db),
    hashes: new Sha256ShortcutHttpHashAdapter(),
  }),
});

function requestMethod(method: string): ShortcutHttpInboundRequest["method"] {
  return method === "POST" ||
    method === "OPTIONS" ||
    method === "PUT" ||
    method === "DELETE"
    ? method
    : "GET";
}

function rawBodyBytes(request: functions.https.Request): number {
  const rawBody = request.rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody.byteLength;
  try {
    return Buffer.byteLength(JSON.stringify(request.body ?? null), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function authorizationShape(
  authorization: string | undefined,
): "missing" | "malformed" | "credential-format-valid" {
  if (authorization === undefined) return "missing";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/u);
  if (
    match?.[1] === undefined ||
    HmacShortcutCredentialSecretAdapter.credentialId(match[1]) === undefined
  ) {
    return "malformed";
  }
  return "credential-format-valid";
}

function setCorsHeaders(
  response: { set(field: string, value?: string): unknown },
  origin: string,
): void {
  response.set("Access-Control-Allow-Origin", origin);
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Idempotency-Key",
  );
  response.set("Access-Control-Max-Age", "600");
}

export const addExpenseFromMessage = functions
  .region(REGION)
  .runWith({
    secrets: ["SHORTCUT_CREDENTIAL_PEPPER"],
    timeoutSeconds: 30,
    memory: "256MB",
  })
  .https.onRequest(async (request, response) => {
    response.set("Cache-Control", "no-store");
    response.set("X-Content-Type-Options", "nosniff");

    const origin = request.get("origin")?.trim();
    if (origin !== undefined) {
      if (!allowedOrigins().has(origin)) {
        response.status(403).json({
          contractVersion: "shortcut-payment-response.v1",
          error: { code: "ORIGIN_NOT_ALLOWED", retryable: false },
        });
        return;
      }
      setCorsHeaders(response, origin);
    }

    const authorization = request.get("authorization");
    const contentType = request.get("content-type");
    const idempotencyKey = request.get("idempotency-key");
    functions.logger.info("shortcut_http_authorization", {
      shape: authorizationShape(authorization),
    });
    let result: Awaited<ReturnType<typeof inbound.handle>>;
    try {
      result = await inbound.handle({
        method: requestMethod(request.method),
        headers: {
          ...(authorization === undefined ? {} : { authorization }),
          ...(contentType === undefined ? {} : { contentType }),
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          ...(origin === undefined ? {} : { origin }),
        },
        rawBodyBytes: rawBodyBytes(request),
        body: request.body,
        receivedAt: new Date().toISOString(),
        remoteAddress:
          request.ip || request.socket.remoteAddress || "unknown-remote-address",
      });
    } catch {
      response.status(503).json({
        contractVersion: "shortcut-payment-response.v1",
        error: {
          code: "PAYMENT_INTAKE_TEMPORARILY_UNAVAILABLE",
          retryable: true,
        },
      });
      return;
    }
    functions.logger.info("shortcut_http_result", {
      status: result.status,
      ...(result.body !== null && "error" in result.body
        ? { errorCode: result.body.error.code }
        : {}),
    });
    if (result.status === 204) {
      response.status(204).send("");
      return;
    }
    response.status(result.status).json(result.body);
  });
