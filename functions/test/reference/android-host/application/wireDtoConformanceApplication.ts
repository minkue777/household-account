import type {
  WireDtoConformanceInputPort,
  WireDtoRoundTripResult,
} from "./ports/in/wireDtoConformanceInputPort";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactlyKeys = (value: JsonRecord, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
};

const isNonBlankString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function decodeBridge(value: JsonRecord): WireDtoRoundTripResult {
  if (!hasExactlyKeys(value, ["contractVersion", "requestId", "operation"])) {
    return { kind: "Rejected", code: "SCHEMA_INVALID" };
  }
  if (!isNonBlankString(value.requestId) || !isRecord(value.operation)) {
    return { kind: "Rejected", code: "SCHEMA_INVALID" };
  }

  const operation = value.operation;
  if (operation.kind === "GET_APP_VERSION") {
    if (!hasExactlyKeys(operation, ["kind"])) {
      return { kind: "Rejected", code: "SCHEMA_INVALID" };
    }
  } else if (operation.kind === "SYNC_SESSION_MIRROR") {
    if (
      !hasExactlyKeys(operation, ["kind", "membershipReceiptId"]) ||
      !isNonBlankString(operation.membershipReceiptId)
    ) {
      return { kind: "Rejected", code: "SCHEMA_INVALID" };
    }
  } else {
    return { kind: "Rejected", code: "SCHEMA_INVALID" };
  }

  return {
    kind: "Decoded",
    kotlinType: "BridgeRequestV1",
    reencodedJson: JSON.stringify(value),
  };
}

function decodeQuickEditSnapshot(value: JsonRecord): WireDtoRoundTripResult {
  if (
    !hasExactlyKeys(value, [
      "contractVersion",
      "transactionId",
      "merchant",
      "amountInWon",
      "categoryId",
      "memo",
      "aggregateVersion",
    ]) ||
    !isNonBlankString(value.transactionId) ||
    typeof value.merchant !== "string" ||
    !Number.isSafeInteger(value.amountInWon) ||
    (value.categoryId !== null && typeof value.categoryId !== "string") ||
    (value.memo !== null && typeof value.memo !== "string") ||
    (value.aggregateVersion !== null &&
      (!Number.isSafeInteger(value.aggregateVersion) ||
        (value.aggregateVersion as number) < 0))
  ) {
    return { kind: "Rejected", code: "SCHEMA_INVALID" };
  }

  return {
    kind: "Decoded",
    kotlinType: "QuickEditSnapshotV1",
    reencodedJson: JSON.stringify(value),
  };
}

export function createWireDtoConformanceApplication(): WireDtoConformanceInputPort {
  return {
    decodeInGeneratedKotlinAndReencode(json) {
      let value: unknown;
      try {
        value = JSON.parse(json);
      } catch {
        return { kind: "Rejected", code: "SCHEMA_INVALID" };
      }

      if (!isRecord(value)) {
        return { kind: "Rejected", code: "SCHEMA_INVALID" };
      }
      if (
        value.contractVersion !== "bridge.v1" &&
        value.contractVersion !== "quick-edit-snapshot.v1"
      ) {
        return typeof value.contractVersion === "string"
          ? { kind: "Rejected", code: "VERSION_UNSUPPORTED" }
          : { kind: "Rejected", code: "SCHEMA_INVALID" };
      }

      return value.contractVersion === "bridge.v1"
        ? decodeBridge(value)
        : decodeQuickEditSnapshot(value);
    },
  };
}
