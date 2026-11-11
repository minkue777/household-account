import type { CaptureDeliveryFailure } from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/in/diagnosticRetentionInputPort";

export interface NotificationDiagnosticWireInput {
  readonly packageName: string;
  readonly title: string;
  readonly text: string;
  readonly bigText: string;
  readonly textLines: readonly string[];
  readonly fullText: string;
  readonly postedAtMillis: number;
  readonly captureFailure?: CaptureDeliveryFailure;
}

export class NotificationDiagnosticValidationError extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
  ) {
    super(`${code}:${path}`);
    this.name = "NotificationDiagnosticValidationError";
  }
}

const PACKAGE_NAME = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
const EXPECTED_FIELDS = new Set([
  "packageName",
  "title",
  "text",
  "bigText",
  "textLines",
  "fullText",
  "postedAtMillis",
  "captureFailure",
]);

const FAILURE_STAGES = new Set(["SCOPE", "ENQUEUE", "QUEUE_READ", "SUBMIT", "LOCAL_COMMIT"]);
const FAILURE_CODES = new Set([
  "AUTH_REQUIRED", "SCOPE_UNAVAILABLE", "REMOTE_ERROR", "RECEIPT_INVALID",
  "PAYLOAD_CONFLICT", "IO_ERROR", "KEYSTORE_ERROR", "PERMISSION_DENIED",
  "UNEXPECTED_ERROR", "SERVER_RETRY_REQUIRED",
  ...["OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED",
    "NOT_FOUND", "ALREADY_EXISTS", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED",
    "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL",
    "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED"].map((code) => `CALLABLE_${code}`),
]);

function decodeCaptureFailure(value: unknown): CaptureDeliveryFailure {
  const path = "$.captureFailure";
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("OBJECT_REQUIRED", path);
  }
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !["observationId", "stage", "code"].includes(key));
  if (unknown !== undefined) fail("UNKNOWN_FIELD", `${path}.${unknown}`);
  const observationId = boundedString(input.observationId, `${path}.observationId`, 256);
  if (!/^[A-Za-z0-9._:-]+$/.test(observationId)) fail("OBSERVATION_ID_INVALID", `${path}.observationId`);
  const stage = boundedString(input.stage, `${path}.stage`, 32);
  if (!FAILURE_STAGES.has(stage)) fail("FAILURE_STAGE_INVALID", `${path}.stage`);
  const code = boundedString(input.code, `${path}.code`, 64);
  if (!FAILURE_CODES.has(code)) fail("FAILURE_CODE_INVALID", `${path}.code`);
  return { observationId, stage: stage as CaptureDeliveryFailure["stage"], code };
}

function fail(code: string, path: string): never {
  throw new NotificationDiagnosticValidationError(code, path);
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("OBJECT_REQUIRED", "$");
  }
  const result = value as Record<string, unknown>;
  const unknown = Object.keys(result).find((key) => !EXPECTED_FIELDS.has(key));
  if (unknown !== undefined) fail("UNKNOWN_FIELD", `$.${unknown}`);
  return result;
}

function boundedString(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") fail("STRING_REQUIRED", path);
  if (value.length > maximumLength) fail("STRING_TOO_LONG", path);
  return value;
}

export function decodeNotificationDiagnostic(
  value: unknown,
): NotificationDiagnosticWireInput {
  const input = objectValue(value);
  const packageName = boundedString(input.packageName, "$.packageName", 255);
  if (!PACKAGE_NAME.test(packageName)) {
    fail("PACKAGE_NAME_INVALID", "$.packageName");
  }

  if (!Array.isArray(input.textLines) || input.textLines.length > 32) {
    fail("TEXT_LINES_INVALID", "$.textLines");
  }
  const textLines = input.textLines.map((line, index) =>
    boundedString(line, `$.textLines[${index}]`, 4_096),
  );

  const postedAtMillis = input.postedAtMillis;
  if (
    typeof postedAtMillis !== "number" ||
    !Number.isSafeInteger(postedAtMillis) ||
    postedAtMillis <= 0 ||
    Number.isNaN(new Date(postedAtMillis).getTime())
  ) {
    fail("POSTED_AT_INVALID", "$.postedAtMillis");
  }

  return {
    packageName,
    title: boundedString(input.title, "$.title", 4_096),
    text: boundedString(input.text, "$.text", 32_768),
    bigText: boundedString(input.bigText, "$.bigText", 65_536),
    textLines,
    fullText: boundedString(input.fullText, "$.fullText", 65_536),
    postedAtMillis,
    ...(input.captureFailure === undefined ? {} : { captureFailure: decodeCaptureFailure(input.captureFailure) }),
  };
}
