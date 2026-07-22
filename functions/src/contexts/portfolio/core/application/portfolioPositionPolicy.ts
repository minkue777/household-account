import type {
  PortfolioCommandMetadata,
  PortfolioPositionKind,
  PortfolioRuntimePosition,
  PortfolioRuntimeState,
} from "./ports/out/portfolioRuntimeStorePort";
import {
  containsOnly,
  finiteNonNegative,
  optionalFiniteNonNegative,
  record,
  requiredText,
  type ParseResult,
} from "./portfolioRuntimeSupport";

export const POSITION_KINDS: ReadonlySet<PortfolioPositionKind> = new Set([
  "stock",
  "crypto",
]);

export const POSITION_FIELDS: ReadonlySet<string> = new Set([
  "assetId",
  "holdingType",
  "stockCode",
  "stockName",
  "marketCode",
  "coinName",
  "quantity",
  "avgPrice",
  "currentPrice",
  "instrumentType",
  "priceScale",
  "quoteAsOf",
  "market",
  "exchange",
  "currency",
]);

function isManualValuationInstrument(
  instrumentType: PortfolioRuntimePosition["instrumentType"] | undefined,
): boolean {
  return (
    instrumentType === "bond" ||
    instrumentType === "cash" ||
    instrumentType === "manual"
  );
}

function positionInstrumentType(
  positionKind: PortfolioPositionKind,
  value: unknown,
): PortfolioRuntimePosition["instrumentType"] | undefined {
  if (positionKind === "crypto") {
    return value === undefined || value === "crypto" ? "crypto" : undefined;
  }
  const normalized = value === undefined ? "stock" : value;
  return typeof normalized === "string" &&
    ["stock", "etf", "etn", "fund", "bond", "cash", "manual"].includes(
      normalized,
    )
    ? (normalized as PortfolioRuntimePosition["instrumentType"])
    : undefined;
}

export function createPositionFromRaw(input: {
  readonly metadata: PortfolioCommandMetadata;
  readonly state: PortfolioRuntimeState;
  readonly assetId: string;
  readonly positionKind: PortfolioPositionKind;
  readonly raw: unknown;
  readonly positionId: string;
}): ParseResult<PortfolioRuntimePosition> {
  const raw = record(input.raw);
  if (raw === undefined || !containsOnly(raw, POSITION_FIELDS)) {
    return { kind: "error", code: "INVALID_POSITION" };
  }
  if (
    raw.assetId !== undefined &&
    (typeof raw.assetId !== "string" || raw.assetId !== input.assetId)
  ) {
    return { kind: "error", code: "ASSET_SCOPE_MISMATCH" };
  }
  const asset = input.state.assets.find(({ assetId }) => assetId === input.assetId);
  if (asset === undefined) return { kind: "error", code: "ASSET_NOT_FOUND" };
  if (asset.lifecycleState !== "active") {
    return { kind: "error", code: "ASSET_NOT_ACTIVE" };
  }
  const compatible =
    input.positionKind === "crypto"
      ? asset.type === "crypto"
      : asset.type === "stock" ||
        (asset.type === "gold" && asset.subType === "stock");
  if (!compatible) {
    return { kind: "error", code: "POSITION_ASSET_TYPE_MISMATCH" };
  }
  const holdingType =
    typeof raw.holdingType === "string" &&
    ["stock", "bond", "cash", "manual"].includes(raw.holdingType)
      ? (raw.holdingType as PortfolioRuntimePosition["holdingType"])
      : undefined;
  const instrumentType = positionInstrumentType(
    input.positionKind,
    raw.instrumentType ??
      (input.positionKind === "stock" && holdingType !== "stock"
        ? holdingType
        : undefined),
  );
  const rawCode = input.positionKind === "stock" ? raw.stockCode : raw.marketCode;
  const code = requiredText(
    isManualValuationInstrument(instrumentType) && rawCode === ""
      ? `MANUAL:${input.positionId}`
      : rawCode,
    "POSITION_INSTRUMENT_REQUIRED",
  );
  const name = requiredText(
    input.positionKind === "stock" ? raw.stockName : raw.coinName,
    "POSITION_INSTRUMENT_REQUIRED",
  );
  const quantity = finiteNonNegative(raw.quantity, "INVALID_QUANTITY");
  const averagePrice = optionalFiniteNonNegative(
    raw.avgPrice,
    0,
    "INVALID_AVERAGE_PRICE",
  );
  const currentPrice = optionalFiniteNonNegative(
    raw.currentPrice,
    undefined,
    "INVALID_CURRENT_PRICE",
  );
  if (
    code.kind === "error" ||
    name.kind === "error" ||
    quantity.kind === "error" ||
    averagePrice.kind === "error" ||
    currentPrice.kind === "error" ||
    instrumentType === undefined
  ) {
    return {
      kind: "error",
      code:
        code.kind === "error"
          ? code.code
          : name.kind === "error"
            ? name.code
            : quantity.kind === "error"
              ? quantity.code
              : averagePrice.kind === "error"
                ? averagePrice.code
                : currentPrice.kind === "error"
                  ? currentPrice.code
                  : "INVALID_INSTRUMENT",
    };
  }
  const defaultScale = instrumentType === "fund" ? 1_000 : 1;
  const priceScale = raw.priceScale ?? defaultScale;
  if (
    typeof priceScale !== "number" ||
    !Number.isFinite(priceScale) ||
    priceScale <= 0
  ) {
    return { kind: "error", code: "INVALID_PRICE_SCALE" };
  }
  if (
    raw.quoteAsOf !== undefined &&
    (typeof raw.quoteAsOf !== "string" || raw.quoteAsOf.trim() === "")
  ) {
    return { kind: "error", code: "INVALID_QUOTE_AS_OF" };
  }
  const explicitMarket =
    raw.market === "KR" ? "KRX" : raw.market === "US" ? "US" : raw.market;
  const market =
    input.positionKind === "crypto"
      ? "UPBIT_KRW"
      : instrumentType === "fund"
        ? explicitMarket === undefined || explicitMarket === "KRX"
          ? "KOFIA_FUND"
          : explicitMarket
        : explicitMarket ?? "UNRESOLVED";
  if (
    !["KRX", "US", "KOFIA_FUND", "UPBIT_KRW", "UNRESOLVED"].includes(
      String(market),
    ) ||
    (input.positionKind === "crypto" &&
      explicitMarket !== undefined &&
      explicitMarket !== "UPBIT_KRW") ||
    (instrumentType === "fund" && market !== "KOFIA_FUND")
  ) {
    return { kind: "error", code: "INVALID_INSTRUMENT_MARKET" };
  }
  if (
    input.positionKind === "stock" &&
    !isManualValuationInstrument(instrumentType) &&
    market === "UNRESOLVED"
  ) {
    return { kind: "error", code: "INSTRUMENT_MARKET_REQUIRED" };
  }
  const exchange = raw.exchange;
  if (
    exchange !== undefined &&
    (typeof exchange !== "string" ||
      !["KOSPI", "KOSDAQ", "KONEX", "NASDAQ", "NYSE", "AMEX"].includes(
        exchange,
      ))
  ) {
    return { kind: "error", code: "INVALID_INSTRUMENT_EXCHANGE" };
  }
  const derivedCurrency = market === "US" ? "USD" : "KRW";
  if (raw.currency !== undefined && raw.currency !== derivedCurrency) {
    return { kind: "error", code: "INVALID_INSTRUMENT_CURRENCY" };
  }
  return {
    kind: "success",
    value: {
      positionId: input.positionId,
      householdId: input.metadata.householdId,
      assetId: input.assetId,
      positionKind: input.positionKind,
      instrumentCode: code.value.toLocaleUpperCase("en-US"),
      instrumentName: name.value,
      instrumentType,
      market: market as PortfolioRuntimePosition["market"],
      ...(exchange === undefined
        ? {}
        : { exchange: exchange as PortfolioRuntimePosition["exchange"] }),
      currency: derivedCurrency,
      ...(holdingType === undefined ? {} : { holdingType }),
      quantity: quantity.value,
      averagePriceInWon: averagePrice.value ?? 0,
      priceScale,
      ...(currentPrice.value === undefined
        ? {}
        : {
            lastQuote: {
              priceInWon: currentPrice.value,
              observedAt:
                typeof raw.quoteAsOf === "string"
                  ? raw.quoteAsOf.trim()
                  : input.metadata.occurredAt,
              provider: "client-observed",
            },
          }),
      ...(typeof raw.quoteAsOf === "string"
        ? { quoteAsOf: raw.quoteAsOf.trim() }
        : {}),
      aggregateVersion: 1,
      lifecycleState: "active",
      createdAt: input.metadata.occurredAt,
      updatedAt: input.metadata.occurredAt,
    },
  };
}
