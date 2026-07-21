import type {
  CaptureBalanceObservation,
  CaptureEnvelopeInput,
  CapturePaymentObservation,
  CaptureSourceEvidence,
} from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/in/captureSubmissionInputPort";

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/u;
const SHA_256 = /^sha256:[a-f0-9]{64}$/u;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const OFFSET_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const CURRENCY_TYPES = new Set(["gyeonggi", "daejeon", "sejong"]);

export class CaptureEnvelopeValidationError extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
  ) {
    super(`${code}:${path}`);
    this.name = "CaptureEnvelopeValidationError";
  }
}

function fail(code: string, path: string): never {
  throw new CaptureEnvelopeValidationError(code, path);
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
  options: { readonly maxLength?: number; readonly nonBlank?: boolean } = {},
): string {
  if (typeof value !== "string") fail("STRING_REQUIRED", path);
  if (options.nonBlank === true && value.trim() === "") {
    fail("NON_BLANK_REQUIRED", path);
  }
  if (value.length > (options.maxLength ?? Number.POSITIVE_INFINITY)) {
    fail("STRING_TOO_LONG", path);
  }
  return value;
}

function stableId(value: unknown, path: string): string {
  const text = stringValue(value, path);
  return STABLE_ID.test(text) ? text : fail("STABLE_ID_INVALID", path);
}

function localDate(value: unknown, path: string): string {
  const text = stringValue(value, path);
  const match = LOCAL_DATE.exec(text);
  if (match === null) fail("LOCAL_DATE_INVALID", path);
  const instant = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (
    instant.getUTCFullYear() !== Number(match[1]) ||
    instant.getUTCMonth() + 1 !== Number(match[2]) ||
    instant.getUTCDate() !== Number(match[3])
  ) {
    fail("LOCAL_DATE_INVALID", path);
  }
  return text;
}

function localTime(value: unknown, path: string): string {
  const text = stringValue(value, path);
  return LOCAL_TIME.test(text) ? text : fail("LOCAL_TIME_INVALID", path);
}

function instant(value: unknown, path: string): string {
  const text = stringValue(value, path);
  return OFFSET_INSTANT.test(text) && Number.isFinite(Date.parse(text))
    ? text
    : fail("OFFSET_INSTANT_INVALID", path);
}

function positiveWon(value: unknown, path: string): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fail("POSITIVE_WON_REQUIRED", path);
}

function integerWon(value: unknown, path: string): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : fail("INTEGER_WON_REQUIRED", path);
}

function currencyType(
  value: unknown,
  path: string,
): "gyeonggi" | "daejeon" | "sejong" {
  const text = stableId(value, path);
  return CURRENCY_TYPES.has(text)
    ? (text as "gyeonggi" | "daejeon" | "sejong")
    : fail("LOCAL_CURRENCY_TYPE_UNSUPPORTED", path);
}

function decodeSource(value: unknown): CaptureSourceEvidence {
  const source = record(value, "$.sourceEvidence");
  const kind = stringValue(source.kind, "$.sourceEvidence.kind");
  if (kind === "android-registered-package") {
    exactKeys(
      source,
      ["kind", "sourceType", "packageName", "registryVersion"],
      ["kind", "sourceType", "packageName", "registryVersion"],
      "$.sourceEvidence",
    );
    const packageName = stringValue(
      source.packageName,
      "$.sourceEvidence.packageName",
      { maxLength: 255 },
    );
    if (!PACKAGE_NAME.test(packageName)) {
      fail("PACKAGE_NAME_INVALID", "$.sourceEvidence.packageName");
    }
    return {
      kind,
      sourceType: stableId(source.sourceType, "$.sourceEvidence.sourceType"),
      packageName,
      registryVersion: stableId(
        source.registryVersion,
        "$.sourceEvidence.registryVersion",
      ),
    };
  }
  if (kind === "ios-shortcut-credential") {
    exactKeys(
      source,
      ["kind", "sourceType", "credentialIdHash"],
      ["kind", "sourceType", "credentialIdHash"],
      "$.sourceEvidence",
    );
    if (source.sourceType !== "ios-shortcut") {
      fail("SOURCE_TYPE_INVALID", "$.sourceEvidence.sourceType");
    }
    const credentialIdHash = stringValue(
      source.credentialIdHash,
      "$.sourceEvidence.credentialIdHash",
    );
    if (!SHA_256.test(credentialIdHash)) {
      fail("SHA256_INVALID", "$.sourceEvidence.credentialIdHash");
    }
    return { kind, sourceType: "ios-shortcut", credentialIdHash };
  }
  return fail("SOURCE_EVIDENCE_INVALID", "$.sourceEvidence.kind");
}

function decodePayment(value: unknown): CapturePaymentObservation {
  const payment = record(value, "$.paymentObservation");
  exactKeys(
    payment,
    [
      "branchId",
      "observationType",
      "amountInWon",
      "occurredLocalDate",
      "occurredLocalTime",
      "zoneId",
      "merchantEvidence",
      "cardEvidence",
      "localCurrencyType",
      "dueDate",
    ],
    ["branchId", "observationType", "amountInWon", "zoneId", "merchantEvidence"],
    "$.paymentObservation",
  );
  const observationType = payment.observationType;
  if (observationType !== "approval" && observationType !== "cancellation") {
    fail("OBSERVATION_TYPE_INVALID", "$.paymentObservation.observationType");
  }
  if (payment.zoneId !== "Asia/Seoul") {
    fail("ZONE_ID_INVALID", "$.paymentObservation.zoneId");
  }
  const hasDate = payment.occurredLocalDate !== undefined;
  const hasTime = payment.occurredLocalTime !== undefined;
  if (hasDate !== hasTime || (observationType === "approval" && !hasDate)) {
    fail("OCCURRED_DATE_TIME_INVALID", "$.paymentObservation");
  }

  const merchant = record(
    payment.merchantEvidence,
    "$.paymentObservation.merchantEvidence",
  );
  exactKeys(
    merchant,
    ["rawCandidate"],
    ["rawCandidate"],
    "$.paymentObservation.merchantEvidence",
  );

  let cardEvidence: CapturePaymentObservation["cardEvidence"];
  if (payment.cardEvidence !== undefined) {
    const card = record(payment.cardEvidence, "$.paymentObservation.cardEvidence");
    exactKeys(
      card,
      ["companyLabel", "maskedToken"],
      ["companyLabel"],
      "$.paymentObservation.cardEvidence",
    );
    cardEvidence = {
      companyLabel: stringValue(
        card.companyLabel,
        "$.paymentObservation.cardEvidence.companyLabel",
        { nonBlank: true, maxLength: 256 },
      ),
      ...(card.maskedToken === undefined
        ? {}
        : {
            maskedToken: stringValue(
              card.maskedToken,
              "$.paymentObservation.cardEvidence.maskedToken",
              { nonBlank: true, maxLength: 64 },
            ),
          }),
    };
  }

  return {
    branchId: stableId(payment.branchId, "$.paymentObservation.branchId"),
    observationType,
    amountInWon: positiveWon(
      payment.amountInWon,
      "$.paymentObservation.amountInWon",
    ),
    ...(hasDate
      ? {
          occurredLocalDate: localDate(
            payment.occurredLocalDate,
            "$.paymentObservation.occurredLocalDate",
          ),
          occurredLocalTime: localTime(
            payment.occurredLocalTime,
            "$.paymentObservation.occurredLocalTime",
          ),
        }
      : {}),
    zoneId: "Asia/Seoul",
    merchantEvidence: {
      rawCandidate: stringValue(
        merchant.rawCandidate,
        "$.paymentObservation.merchantEvidence.rawCandidate",
        { nonBlank: true, maxLength: 256 },
      ),
    },
    ...(cardEvidence === undefined ? {} : { cardEvidence }),
    ...(payment.localCurrencyType === undefined
      ? {}
      : {
          localCurrencyType: currencyType(
            payment.localCurrencyType,
            "$.paymentObservation.localCurrencyType",
          ),
        }),
    ...(payment.dueDate === undefined
      ? {}
      : {
          dueDate: localDate(payment.dueDate, "$.paymentObservation.dueDate"),
        }),
  };
}

function decodeBalance(value: unknown): CaptureBalanceObservation {
  const balance = record(value, "$.balanceObservation");
  exactKeys(
    balance,
    ["branchId", "currencyType", "balanceInWon", "observedAt"],
    ["branchId", "currencyType", "balanceInWon", "observedAt"],
    "$.balanceObservation",
  );
  return {
    branchId: stableId(balance.branchId, "$.balanceObservation.branchId"),
    currencyType: currencyType(
      balance.currencyType,
      "$.balanceObservation.currencyType",
    ),
    balanceInWon: integerWon(
      balance.balanceInWon,
      "$.balanceObservation.balanceInWon",
    ),
    observedAt: instant(balance.observedAt, "$.balanceObservation.observedAt"),
  };
}

export function decodeCaptureEnvelope(value: unknown): CaptureEnvelopeInput {
  const envelope = record(value, "$");
  exactKeys(
    envelope,
    [
      "contractVersion",
      "observationId",
      "originChannel",
      "sourceEvidence",
      "observedAt",
      "parser",
      "rawPayloadHash",
      "paymentObservation",
      "balanceObservation",
    ],
    [
      "contractVersion",
      "observationId",
      "originChannel",
      "sourceEvidence",
      "observedAt",
      "parser",
      "rawPayloadHash",
    ],
    "$",
  );
  if (envelope.contractVersion !== "capture-envelope.v1") {
    fail("CONTRACT_VERSION_UNSUPPORTED", "$.contractVersion");
  }
  const originChannel = envelope.originChannel;
  if (
    originChannel !== "android-notification" &&
    originChannel !== "ios-shortcut"
  ) {
    fail("ORIGIN_CHANNEL_INVALID", "$.originChannel");
  }
  const parser = record(envelope.parser, "$.parser");
  exactKeys(
    parser,
    ["parserId", "parserVersion"],
    ["parserId", "parserVersion"],
    "$.parser",
  );
  const rawPayloadHash = stringValue(envelope.rawPayloadHash, "$.rawPayloadHash");
  if (!SHA_256.test(rawPayloadHash)) fail("SHA256_INVALID", "$.rawPayloadHash");

  const sourceEvidence = decodeSource(envelope.sourceEvidence);
  const paymentObservation =
    envelope.paymentObservation === undefined
      ? undefined
      : decodePayment(envelope.paymentObservation);
  const balanceObservation =
    envelope.balanceObservation === undefined
      ? undefined
      : decodeBalance(envelope.balanceObservation);
  if (paymentObservation === undefined && balanceObservation === undefined) {
    fail("EMPTY_CAPTURE", "$");
  }
  if (
    paymentObservation !== undefined &&
    balanceObservation !== undefined &&
    paymentObservation.branchId === balanceObservation.branchId
  ) {
    fail("BRANCH_ID_COLLISION", "$");
  }
  if (
    (originChannel === "android-notification" &&
      sourceEvidence.kind !== "android-registered-package") ||
    (originChannel === "ios-shortcut" &&
      sourceEvidence.kind !== "ios-shortcut-credential")
  ) {
    fail("SOURCE_CHANNEL_MISMATCH", "$.sourceEvidence");
  }
  if (
    originChannel === "ios-shortcut" &&
    (paymentObservation?.observationType !== "approval" ||
      paymentObservation.cardEvidence === undefined ||
      balanceObservation !== undefined)
  ) {
    fail("IOS_SHORTCUT_SHAPE_INVALID", "$");
  }

  return {
    contractVersion: "capture-envelope.v1",
    observationId: stableId(envelope.observationId, "$.observationId"),
    originChannel,
    sourceEvidence,
    observedAt: instant(envelope.observedAt, "$.observedAt"),
    parser: {
      parserId: stableId(parser.parserId, "$.parser.parserId"),
      parserVersion: stableId(
        parser.parserVersion,
        "$.parser.parserVersion",
      ),
    },
    rawPayloadHash,
    ...(paymentObservation === undefined ? {} : { paymentObservation }),
    ...(balanceObservation === undefined ? {} : { balanceObservation }),
  };
}
