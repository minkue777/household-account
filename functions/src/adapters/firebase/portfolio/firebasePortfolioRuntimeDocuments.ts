import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  PortfolioCommandMetadata,
  PortfolioCommandResult,
  PortfolioRuntimeAsset,
  PortfolioRuntimeAutomationPlan,
  PortfolioRuntimePosition,
} from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { firestoreTtlAfter } from "../shared/firestoreTtl";
import { hash } from "./firebasePortfolioRuntimeValues";

const RECEIPT_CONTEXT = "portfolio";
const RECEIPT_RETENTION_MILLIS = 30 * 24 * 60 * 60 * 1_000;

function optionalWriteField(
  created: boolean,
  field: string,
  value: unknown,
): Readonly<Record<string, unknown>> {
  return value === undefined
    ? created
      ? {}
      : { [field]: FieldValue.delete() }
    : { [field]: value };
}

export function canonicalAssetDocument(
  asset: PortfolioRuntimeAsset,
  created: boolean,
): Readonly<Record<string, unknown>> {
  return {
    assetId: asset.assetId,
    householdId: asset.householdId,
    name: asset.name,
    type: asset.type,
    ...optionalWriteField(created, "subType", asset.subType),
    ownerRef: asset.ownerRef,
    currency: asset.currency,
    currentBalance: asset.currentBalance,
    ...optionalWriteField(created, "costBasis", asset.costBasis),
    memo: asset.memo,
    order: asset.order,
    lifecycleState: asset.lifecycleState,
    aggregateVersion: asset.aggregateVersion,
    ...optionalWriteField(created, "deletedAt", asset.deletedAt),
    ...optionalWriteField(created, "initialInvestment", asset.initialInvestment),
    ...optionalWriteField(created, "quantity", asset.quantity),
    ...optionalWriteField(created, "stockCode", asset.stockCode),
    ...optionalWriteField(created, "icon", asset.icon),
    ...optionalWriteField(created, "color", asset.color),
    automation: { ...asset.automation },
    schemaVersion: 1,
    ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function legacyAssetDocument(
  asset: PortfolioRuntimeAsset,
  created: boolean,
): Readonly<Record<string, unknown>> {
  return {
    householdId: asset.householdId,
    name: asset.name,
    type: asset.type,
    ...optionalWriteField(
      created,
      "subType",
      asset.legacySubType ?? asset.subType,
    ),
    owner: asset.ownerDisplayName,
    ownerRef: asset.ownerRef,
    currentBalance: asset.currentBalance,
    ...optionalWriteField(created, "costBasis", asset.costBasis),
    ...optionalWriteField(created, "initialInvestment", asset.initialInvestment),
    currency: asset.currency,
    memo: asset.memo,
    ...optionalWriteField(created, "icon", asset.icon),
    ...optionalWriteField(created, "color", asset.color),
    isActive: asset.lifecycleState === "active",
    order: asset.order,
    ...optionalWriteField(created, "stockCode", asset.stockCode),
    ...optionalWriteField(created, "quantity", asset.quantity),
    recurringContributionAmount: asset.automation.recurringContributionAmount,
    recurringContributionDay: asset.automation.recurringContributionDay,
    lastAutoContributionMonth: asset.automation.lastAutoContributionMonth,
    loanInterestRate: asset.automation.loanInterestRate,
    loanRepaymentMethod: asset.automation.loanRepaymentMethod,
    loanMonthlyPaymentAmount: asset.automation.loanMonthlyPaymentAmount,
    loanPaymentDay: asset.automation.loanPaymentDay,
    lastAutoRepaymentMonth: asset.automation.lastAutoRepaymentMonth,
    aggregateVersion: asset.aggregateVersion,
    ...optionalWriteField(created, "deletedAt", asset.deletedAt),
    schemaVersion: 1,
    ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function canonicalPositionDocument(
  position: PortfolioRuntimePosition,
  created: boolean,
): Readonly<Record<string, unknown>> {
  return {
    positionId: position.positionId,
    householdId: position.householdId,
    assetId: position.assetId,
    positionKind: position.positionKind,
    instrumentCode: position.instrumentCode,
    instrumentName: position.instrumentName,
    instrumentType: position.instrumentType,
    market: position.market,
    ...optionalWriteField(created, "exchange", position.exchange),
    currency: position.currency,
    ...optionalWriteField(created, "holdingType", position.holdingType),
    instrument: {
      market: position.market,
      ...(position.exchange === undefined ? {} : { exchange: position.exchange }),
      instrumentType: position.instrumentType.toLocaleUpperCase("en-US"),
      code: position.instrumentCode,
      name: position.instrumentName,
      currency: position.currency,
      priceScale: position.priceScale,
    },
    quantity: position.quantity,
    averagePriceInWon: position.averagePriceInWon,
    priceScale: position.priceScale,
    ...optionalWriteField(created, "lastQuote", position.lastQuote),
    ...optionalWriteField(created, "quoteAsOf", position.quoteAsOf),
    lifecycleState: position.lifecycleState,
    aggregateVersion: position.aggregateVersion,
    schemaVersion: 1,
    ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function legacyPositionDocument(
  position: PortfolioRuntimePosition,
  created: boolean,
): Readonly<Record<string, unknown>> {
  const common = {
    householdId: position.householdId,
    assetId: position.assetId,
    quantity: position.quantity,
    avgPrice: position.averagePriceInWon,
    market: position.market,
    ...optionalWriteField(created, "exchange", position.exchange),
    currency: position.currency,
    ...optionalWriteField(
      created,
      "currentPrice",
      position.lastQuote?.priceInWon,
    ),
    ...optionalWriteField(created, "quoteAsOf", position.quoteAsOf),
    aggregateVersion: position.aggregateVersion,
    schemaVersion: 1,
    ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
  return position.positionKind === "stock"
    ? {
        ...common,
        holdingType: position.holdingType ?? "stock",
        stockCode: position.instrumentCode,
        stockName: position.instrumentName,
        instrumentType: position.instrumentType,
        priceScale: position.priceScale,
      }
    : {
        ...common,
        marketCode: position.instrumentCode,
        coinName: position.instrumentName,
      };
}

export function planDocument(
  plan: PortfolioRuntimeAutomationPlan,
  created: boolean,
): Readonly<Record<string, unknown>> {
  return {
    planId: plan.planId,
    householdId: plan.householdId,
    assetId: plan.assetId,
    operation: plan.operation,
    kind: plan.kind,
    status: plan.status,
    amountInWon: plan.amountInWon,
    configuredDay: plan.configuredDay,
    firstActivatedOn: plan.firstActivatedOn,
    activationMonthDisposition: plan.activationMonthDisposition,
    firstApplicableMonth: plan.firstApplicableMonth,
    nextDueDate: plan.nextDueDate,
    ...optionalWriteField(created, "lastAppliedMonth", plan.lastAppliedMonth),
    ...optionalWriteField(created, "repaymentMethod", plan.repaymentMethod),
    ...optionalWriteField(
      created,
      "annualInterestRate",
      plan.annualInterestRate,
    ),
    currentRevision: plan.currentRevision,
    aggregateVersion: plan.aggregateVersion,
    schemaVersion: 1,
    ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function receiptReference(
  database: firestore.Firestore,
  metadata: PortfolioCommandMetadata,
): firestore.DocumentReference {
  return database
    .collection("commandReceipts")
    .doc(RECEIPT_CONTEXT)
    .collection("receipts")
    .doc(hash(`${metadata.householdId}\u0000${metadata.idempotencyKey}`));
}

export function receiptDocument(
  metadata: PortfolioCommandMetadata,
  result: PortfolioCommandResult,
): Readonly<Record<string, unknown>> {
  const occurred = Date.parse(metadata.occurredAt);
  return {
    householdId: metadata.householdId,
    principalUid: metadata.principalUid,
    actorMemberId: metadata.actorMemberId,
    commandId: metadata.commandId,
    idempotencyKey: metadata.idempotencyKey,
    command: metadata.commandName,
    payloadFingerprint: metadata.payloadFingerprint,
    result,
    status: "completed",
    terminalAt: metadata.occurredAt,
    completedAt: metadata.occurredAt,
    expiresAt: firestoreTtlAfter(
      new Date(Number.isFinite(occurred) ? occurred : Date.now()),
      RECEIPT_RETENTION_MILLIS,
    ),
    schemaVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
  };
}
