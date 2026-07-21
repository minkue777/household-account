export interface NotificationDiagnosticWireInput {
  readonly packageName: string;
  readonly title: string;
  readonly text: string;
  readonly bigText: string;
  readonly textLines: readonly string[];
  readonly fullText: string;
  readonly postedAtMillis: number;
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
]);

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
  };
}
