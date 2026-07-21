import type { AndroidRawNotificationInput } from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/in/androidRawNotificationSubmissionInputPort";

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/u;
const OFFSET_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAX_TOTAL_TEXT_LENGTH = 65_536;

export class AndroidRawNotificationValidationError extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
  ) {
    super(`${code}:${path}`);
    this.name = "AndroidRawNotificationValidationError";
  }
}

function fail(code: string, path: string): never {
  throw new AndroidRawNotificationValidationError(code, path);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("OBJECT_REQUIRED", path);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown !== undefined) fail("UNKNOWN_FIELD", `${path}.${unknown}`);
  const missing = required.find(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (missing !== undefined) fail("REQUIRED_FIELD", `${path}.${missing}`);
}

function stringValue(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") fail("STRING_REQUIRED", path);
  if (value.length > maximumLength) fail("STRING_TOO_LONG", path);
  return value;
}

function optionalString(
  value: unknown,
  path: string,
  maximumLength: number,
): string | undefined {
  return value === undefined
    ? undefined
    : stringValue(value, path, maximumLength);
}

export function decodeAndroidRawNotification(
  value: unknown,
): AndroidRawNotificationInput {
  const input = record(value, "$");
  exactKeys(
    input,
    ["contractVersion", "observationId", "packageName", "notification"],
    ["contractVersion", "observationId", "packageName", "notification"],
    "$",
  );
  if (input.contractVersion !== "android-raw-notification.v1") {
    fail("CONTRACT_VERSION_UNSUPPORTED", "$.contractVersion");
  }

  const observationId = stringValue(input.observationId, "$.observationId", 128);
  if (!STABLE_ID.test(observationId)) {
    fail("STABLE_ID_INVALID", "$.observationId");
  }
  const packageName = stringValue(input.packageName, "$.packageName", 255);
  if (!PACKAGE_NAME.test(packageName)) {
    fail("PACKAGE_NAME_INVALID", "$.packageName");
  }

  const notification = record(input.notification, "$.notification");
  exactKeys(
    notification,
    ["postedAt", "title", "text", "bigText", "textLines"],
    ["postedAt"],
    "$.notification",
  );
  const postedAt = stringValue(
    notification.postedAt,
    "$.notification.postedAt",
    64,
  );
  if (!OFFSET_INSTANT.test(postedAt) || !Number.isFinite(Date.parse(postedAt))) {
    fail("OFFSET_INSTANT_INVALID", "$.notification.postedAt");
  }

  const title = optionalString(notification.title, "$.notification.title", 4_096);
  const text = optionalString(notification.text, "$.notification.text", 32_768);
  const bigText = optionalString(
    notification.bigText,
    "$.notification.bigText",
    65_536,
  );
  let textLines: readonly string[] | undefined;
  if (notification.textLines !== undefined) {
    if (!Array.isArray(notification.textLines) || notification.textLines.length > 32) {
      fail("TEXT_LINES_INVALID", "$.notification.textLines");
    }
    textLines = notification.textLines.map((line, index) =>
      stringValue(line, `$.notification.textLines[${index}]`, 4_096),
    );
  }
  const totalTextLength =
    (title?.length ?? 0) +
    (text?.length ?? 0) +
    (bigText?.length ?? 0) +
    (textLines?.reduce((sum, line) => sum + line.length, 0) ?? 0);
  if (totalTextLength > MAX_TOTAL_TEXT_LENGTH) {
    fail("NOTIFICATION_TOO_LARGE", "$.notification");
  }

  return {
    contractVersion: "android-raw-notification.v1",
    observationId,
    packageName,
    notification: {
      postedAt,
      ...(title === undefined ? {} : { title }),
      ...(text === undefined ? {} : { text }),
      ...(bigText === undefined ? {} : { bigText }),
      ...(textLines === undefined ? {} : { textLines }),
    },
  };
}
