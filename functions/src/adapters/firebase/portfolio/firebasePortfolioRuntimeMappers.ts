import type * as firestore from "firebase-admin/firestore";

import {
  normalizeCanonicalAssetSubType,
  type AssetOwnerRef,
  type AssetType,
} from "../../../contexts/portfolio/core/public";
import type {
  PortfolioOwnerProfileReference,
  PortfolioRuntimeAsset,
  PortfolioRuntimeAutomationPlan,
  PortfolioRuntimePosition,
} from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import {
  finite,
  iso,
  optionalText,
  record,
  safeVersion,
  safeWon,
  text,
} from "./firebasePortfolioRuntimeValues";

const ASSET_TYPES = new Set<AssetType>([
  "savings",
  "stock",
  "crypto",
  "property",
  "gold",
  "loan",
]);

function ownerRefFromData(
  data: FirebaseFirestore.DocumentData,
  ownerProfiles: readonly PortfolioOwnerProfileReference[],
): { readonly ownerRef: AssetOwnerRef; readonly ownerDisplayName: string } {
  const raw = data.ownerRef;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const candidate = raw as Record<string, unknown>;
    if (candidate.kind === "household") {
      return { ownerRef: { kind: "household" }, ownerDisplayName: "가구" };
    }
    if (
      candidate.kind === "profile" &&
      typeof candidate.profileId === "string" &&
      candidate.profileId.trim() !== ""
    ) {
      const profileId = candidate.profileId.trim();
      const profile = ownerProfiles.find((entry) => entry.profileId === profileId);
      return {
        ownerRef: { kind: "profile", profileId },
        ownerDisplayName: profile?.displayName ?? text(data, "owner", profileId),
      };
    }
  }
  const legacyOwner = text(data, "owner", "가구");
  if (legacyOwner === "" || legacyOwner === "가구") {
    return { ownerRef: { kind: "household" }, ownerDisplayName: "가구" };
  }
  const matches = ownerProfiles.filter(
    ({ displayName }) => displayName === legacyOwner,
  );
  return matches.length === 1
    ? {
        ownerRef: { kind: "profile", profileId: matches[0].profileId },
        ownerDisplayName: matches[0].displayName,
      }
    : { ownerRef: { kind: "household" }, ownerDisplayName: legacyOwner };
}

export function mapOwnerProfiles(
  householdId: string,
  snapshots: readonly firestore.QueryDocumentSnapshot[],
): readonly PortfolioOwnerProfileReference[] {
  return snapshots.flatMap((snapshot) => {
    const data = snapshot.data();
    const displayName = optionalText(data, "displayName");
    const lifecycle = text(data, "lifecycleState", "active");
    return displayName !== undefined &&
      (lifecycle === "active" || lifecycle === "archived")
      ? [
          {
            profileId: snapshot.id,
            householdId,
            displayName,
            lifecycleState: lifecycle,
          } satisfies PortfolioOwnerProfileReference,
        ]
      : [];
  });
}

export function mapAsset(input: {
  readonly householdId: string;
  readonly assetId: string;
  readonly canonical?: FirebaseFirestore.DocumentData;
  readonly legacy?: FirebaseFirestore.DocumentData;
  readonly ownerProfiles: readonly PortfolioOwnerProfileReference[];
}): PortfolioRuntimeAsset | undefined {
  const merged = { ...(input.legacy ?? {}), ...(input.canonical ?? {}) };
  const rawType = merged.type;
  if (typeof rawType !== "string" || !ASSET_TYPES.has(rawType as AssetType)) {
    return undefined;
  }
  const type = rawType as AssetType;
  const canonicalSubType = normalizeCanonicalAssetSubType(type, merged.subType);
  const legacySubType = optionalText(input.legacy, "subType");
  const owner = ownerRefFromData(merged, input.ownerProfiles);
  const lifecycle = text(
    input.canonical,
    "lifecycleState",
    input.legacy?.isActive === false ? "deleted" : "active",
  );
  const currency = text(merged, "currency", "KRW");
  const costBasisValue = merged.costBasis;
  const quantityValue = merged.quantity;
  const initialInvestmentValue = merged.initialInvestment;
  return {
    assetId: input.assetId,
    householdId: input.householdId,
    name: text(merged, "name", input.assetId),
    type,
    ...(canonicalSubType?.canonical === undefined
      ? {}
      : { subType: canonicalSubType.canonical }),
    ...(legacySubType === undefined ? {} : { legacySubType }),
    ownerRef: owner.ownerRef,
    ownerDisplayName: owner.ownerDisplayName,
    currency: currency === "USD" ? "USD" : "KRW",
    currentBalance: safeWon(merged, "currentBalance"),
    ...(typeof costBasisValue === "number" && Number.isFinite(costBasisValue)
      ? { costBasis: Math.max(0, Math.round(costBasisValue)) }
      : {}),
    memo: text(merged, "memo"),
    order: Math.max(0, Math.round(finite(merged, "order", 0))),
    lifecycleState:
      lifecycle === "deleted" || lifecycle === "purging"
        ? lifecycle
        : "active",
    aggregateVersion: safeVersion(merged),
    createdAt: iso(merged.createdAt),
    updatedAt: iso(merged.updatedAt),
    ...(merged.deletedAt === undefined ? {} : { deletedAt: iso(merged.deletedAt) }),
    ...(typeof initialInvestmentValue === "number" &&
    Number.isFinite(initialInvestmentValue)
      ? { initialInvestment: Math.max(0, Math.round(initialInvestmentValue)) }
      : {}),
    ...(typeof quantityValue === "number" && Number.isFinite(quantityValue)
      ? { quantity: Math.max(0, quantityValue) }
      : {}),
    ...(optionalText(merged, "stockCode") === undefined
      ? {}
      : { stockCode: optionalText(merged, "stockCode") }),
    ...(optionalText(merged, "icon") === undefined
      ? {}
      : { icon: optionalText(merged, "icon") }),
    ...(optionalText(merged, "color") === undefined
      ? {}
      : { color: optionalText(merged, "color") }),
    automation: {
      recurringContributionAmount: safeWon(
        merged,
        "recurringContributionAmount",
      ),
      recurringContributionDay: Math.max(
        0,
        Math.round(finite(merged, "recurringContributionDay", 0)),
      ),
      lastAutoContributionMonth: text(merged, "lastAutoContributionMonth"),
      loanInterestRate: Math.max(0, finite(merged, "loanInterestRate", 0)),
      loanRepaymentMethod: text(merged, "loanRepaymentMethod"),
      loanMonthlyPaymentAmount: safeWon(merged, "loanMonthlyPaymentAmount"),
      loanPaymentDay: Math.max(
        0,
        Math.round(finite(merged, "loanPaymentDay", 0)),
      ),
      lastAutoRepaymentMonth: text(merged, "lastAutoRepaymentMonth"),
    },
  };
}

function mapQuote(
  data: FirebaseFirestore.DocumentData,
): PortfolioRuntimePosition["lastQuote"] {
  const raw = data.lastQuote;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const quote = raw as Record<string, unknown>;
    if (
      typeof quote.priceInWon === "number" &&
      Number.isFinite(quote.priceInWon) &&
      quote.priceInWon >= 0 &&
      typeof quote.observedAt === "string" &&
      typeof quote.provider === "string"
    ) {
      return {
        priceInWon: quote.priceInWon,
        observedAt: quote.observedAt,
        provider: quote.provider,
      };
    }
  }
  const currentPrice = data.currentPrice;
  return typeof currentPrice === "number" &&
    Number.isFinite(currentPrice) &&
    currentPrice >= 0
    ? {
        priceInWon: currentPrice,
        observedAt: text(data, "quoteAsOf", iso(data.updatedAt)),
        provider: text(data, "quoteProvider", "legacy-observed"),
      }
    : undefined;
}

export function mapPosition(input: {
  readonly householdId: string;
  readonly assetId: string;
  readonly positionId: string;
  readonly sourceKind: "stock" | "crypto";
  readonly canonical?: FirebaseFirestore.DocumentData;
  readonly legacy?: FirebaseFirestore.DocumentData;
}): PortfolioRuntimePosition | undefined {
  const merged = { ...(input.legacy ?? {}), ...(input.canonical ?? {}) };
  const positionKind = text(merged, "positionKind", input.sourceKind);
  if (positionKind !== "stock" && positionKind !== "crypto") return undefined;
  const instrumentCode = text(
    merged,
    "instrumentCode",
    text(merged, positionKind === "stock" ? "stockCode" : "marketCode"),
  );
  const instrumentName = text(
    merged,
    "instrumentName",
    text(merged, positionKind === "stock" ? "stockName" : "coinName"),
  );
  if (instrumentCode === "" || instrumentName === "") return undefined;
  const rawInstrumentType = text(
    merged,
    "instrumentType",
    positionKind === "crypto" ? "crypto" : "stock",
  );
  const instrumentType = [
    "stock",
    "etf",
    "etn",
    "fund",
    "bond",
    "cash",
    "manual",
    "crypto",
  ].includes(rawInstrumentType)
    ? (rawInstrumentType as PortfolioRuntimePosition["instrumentType"])
    : positionKind === "crypto"
      ? "crypto"
      : "stock";
  const rawHoldingType = text(merged, "holdingType");
  const holdingType = ["stock", "bond", "cash", "manual"].includes(
    rawHoldingType,
  )
    ? (rawHoldingType as PortfolioRuntimePosition["holdingType"])
    : undefined;
  const lifecycle = text(merged, "lifecycleState", "active");
  const instrument = record(merged.instrument);
  const rawMarket =
    optionalText(merged, "market") ?? optionalText(instrument, "market");
  const market = ["KRX", "US", "KOFIA_FUND", "UPBIT_KRW"].includes(
    rawMarket ?? "",
  )
    ? (rawMarket as PortfolioRuntimePosition["market"])
    : "UNRESOLVED";
  const rawExchange =
    optionalText(merged, "exchange") ?? optionalText(instrument, "exchange");
  const exchange = ["KOSPI", "KOSDAQ", "KONEX", "NASDAQ", "NYSE", "AMEX"].includes(
    rawExchange ?? "",
  )
    ? (rawExchange as PortfolioRuntimePosition["exchange"])
    : undefined;
  const rawCurrency =
    optionalText(merged, "currency") ?? optionalText(instrument, "currency");
  const currency = rawCurrency === "USD" ? "USD" : "KRW";
  const quote = mapQuote(merged);
  const quoteAsOf = optionalText(merged, "quoteAsOf");
  return {
    positionId: input.positionId,
    householdId: input.householdId,
    assetId: input.assetId,
    positionKind,
    instrumentCode: instrumentCode.toLocaleUpperCase("en-US"),
    instrumentName,
    instrumentType,
    market,
    ...(exchange === undefined ? {} : { exchange }),
    currency,
    ...(holdingType === undefined ? {} : { holdingType }),
    quantity: Math.max(0, finite(merged, "quantity", 0)),
    averagePriceInWon: Math.max(
      0,
      finite(merged, "averagePriceInWon", finite(merged, "avgPrice", 0)),
    ),
    priceScale: Math.max(1, finite(merged, "priceScale", 1)),
    ...(quote === undefined ? {} : { lastQuote: quote }),
    ...(quoteAsOf === undefined ? {} : { quoteAsOf }),
    aggregateVersion: safeVersion(merged),
    lifecycleState: lifecycle === "deleted" ? "deleted" : "active",
    createdAt: iso(merged.createdAt),
    updatedAt: iso(merged.updatedAt),
  };
}

export function mapPlan(
  householdId: string,
  snapshot: firestore.QueryDocumentSnapshot,
): PortfolioRuntimeAutomationPlan | undefined {
  const data = snapshot.data();
  const assetId = optionalText(data, "assetId");
  const operation = text(data, "operation");
  const kind = text(data, "kind");
  const status = text(data, "status");
  if (
    assetId === undefined ||
    (operation !== "savings-contribution" && operation !== "loan-repayment") ||
    (kind !== "savings-deposit" && kind !== "loan-repayment") ||
    (status !== "active" && status !== "suspended" && status !== "needs-attention")
  ) {
    return undefined;
  }
  const disposition = text(data, "activationMonthDisposition", "applicable");
  const repaymentMethod = optionalText(data, "repaymentMethod");
  const interest = data.annualInterestRate;
  const lastAppliedMonth = optionalText(data, "lastAppliedMonth");
  return {
    planId: snapshot.id,
    householdId,
    assetId,
    operation,
    kind,
    status,
    amountInWon: safeWon(data, "amountInWon"),
    configuredDay: Math.max(1, Math.round(finite(data, "configuredDay", 1))),
    firstActivatedOn: text(data, "firstActivatedOn", "1970-01-01"),
    activationMonthDisposition:
      disposition === "included" ? "included" : "applicable",
    firstApplicableMonth: text(data, "firstApplicableMonth", "1970-01"),
    nextDueDate: text(data, "nextDueDate", "1970-01-01"),
    ...(lastAppliedMonth === undefined ? {} : { lastAppliedMonth }),
    ...(repaymentMethod === undefined ? {} : { repaymentMethod }),
    ...(typeof interest === "number" && Number.isFinite(interest)
      ? { annualInterestRate: Math.max(0, interest) }
      : {}),
    currentRevision: Math.max(1, Math.round(finite(data, "currentRevision", 1))),
    aggregateVersion: safeVersion(data),
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  };
}
