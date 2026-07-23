import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  CaptureConfigurationCard,
  CaptureConfigurationSnapshot,
} from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/out/captureConfigurationQueryPort";
import type {
  MerchantMatchType,
  MerchantRuleCandidate,
} from "../../../contexts/payment-capture/configuration/domain/policies/merchantRuleSelection";

const PROJECTION_COLLECTION = "runtimeProjections";
const PROJECTION_DOCUMENT = "payment-capture-configuration-v1";
const PROJECTION_SCHEMA_VERSION = 1;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" && candidate.trim() !== ""
    ? candidate.trim()
    : undefined;
}

function optionalText(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" && candidate.trim() !== ""
    ? candidate.trim()
    : undefined;
}

function matchType(value: unknown): MerchantMatchType | undefined {
  return value === "exact" ||
    value === "startsWith" ||
    value === "endsWith" ||
    value === "contains"
    ? value
    : undefined;
}

function decodeCard(value: unknown): CaptureConfigurationCard | undefined {
  const fields = record(value);
  const cardId = text(fields, "cardId");
  const ownerMemberId = text(fields, "ownerMemberId");
  const companyLabel = text(fields, "companyLabel");
  const lifecycleState = fields?.lifecycleState;
  if (
    cardId === undefined ||
    ownerMemberId === undefined ||
    companyLabel === undefined ||
    (lifecycleState !== "active" && lifecycleState !== "retired")
  ) {
    return undefined;
  }
  const lastFour = optionalText(fields, "lastFour");
  return {
    cardId,
    ownerMemberId,
    companyLabel,
    ...(lastFour === undefined ? {} : { lastFour }),
    lifecycleState,
  };
}

function decodeRule(value: unknown): MerchantRuleCandidate | undefined {
  const fields = record(value);
  const ruleId = text(fields, "ruleId");
  const keyword = text(fields, "keyword");
  const type = matchType(fields?.matchType);
  if (
    ruleId === undefined ||
    keyword === undefined ||
    type === undefined ||
    typeof fields?.active !== "boolean"
  ) {
    return undefined;
  }
  const rawPriority = fields.priority;
  const priority =
    typeof rawPriority === "number" && Number.isSafeInteger(rawPriority)
      ? rawPriority
      : undefined;
  if (type !== "exact" && (priority === undefined || priority <= 0)) {
    return undefined;
  }
  const mapping = record(fields.mapping) ?? {};
  const merchant = optionalText(mapping, "merchant");
  const categoryId = optionalText(mapping, "categoryId");
  const memo = optionalText(mapping, "memo");
  return {
    ruleId,
    keyword,
    matchType: type,
    ...(priority === undefined ? {} : { priority }),
    active: fields.active,
    mapping: {
      ...(merchant === undefined ? {} : { merchant }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(memo === undefined ? {} : { memo }),
    },
  };
}

export function captureConfigurationProjectionReference(
  database: firestore.Firestore,
  householdId: string,
): firestore.DocumentReference {
  return database
    .collection("households")
    .doc(householdId)
    .collection(PROJECTION_COLLECTION)
    .doc(PROJECTION_DOCUMENT);
}

export function encodeCaptureConfigurationProjection(
  householdId: string,
  value: CaptureConfigurationSnapshot,
): Readonly<Record<string, unknown>> {
  return {
    householdId,
    cards: value.cards.map((card) => ({ ...card })),
    merchantRules: value.merchantRules.map((rule) => ({
      ...rule,
      mapping: { ...rule.mapping },
    })),
    activeCategoryIds: [...value.activeCategoryIds].sort(),
    ...(value.defaultCategoryId === undefined
      ? {}
      : { defaultCategoryId: value.defaultCategoryId }),
    schemaVersion: PROJECTION_SCHEMA_VERSION,
    rebuiltAt: FieldValue.serverTimestamp(),
  };
}

export function decodeCaptureConfigurationProjection(
  householdId: string,
  value: FirebaseFirestore.DocumentData | undefined,
): CaptureConfigurationSnapshot | undefined {
  if (
    value?.schemaVersion !== PROJECTION_SCHEMA_VERSION ||
    value.householdId !== householdId ||
    !Array.isArray(value.cards) ||
    !Array.isArray(value.merchantRules) ||
    !Array.isArray(value.activeCategoryIds)
  ) {
    return undefined;
  }
  const cards = value.cards.map(decodeCard);
  const merchantRules = value.merchantRules.map(decodeRule);
  const activeCategoryIds = value.activeCategoryIds.filter(
    (candidate: unknown): candidate is string =>
      typeof candidate === "string" && candidate.trim() !== "",
  );
  if (
    cards.some((card) => card === undefined) ||
    merchantRules.some((rule) => rule === undefined) ||
    activeCategoryIds.length !== value.activeCategoryIds.length
  ) {
    return undefined;
  }
  const defaultCategoryId =
    typeof value.defaultCategoryId === "string" &&
    value.defaultCategoryId.trim() !== ""
      ? value.defaultCategoryId.trim()
      : undefined;
  return {
    cards: cards as CaptureConfigurationCard[],
    merchantRules: merchantRules as MerchantRuleCandidate[],
    activeCategoryIds: new Set(activeCategoryIds),
    ...(defaultCategoryId === undefined ? {} : { defaultCategoryId }),
  };
}

export function invalidateCaptureConfigurationProjection(
  transaction: firestore.Transaction,
  database: firestore.Firestore,
  householdId: string,
): void {
  transaction.delete(
    captureConfigurationProjectionReference(database, householdId),
  );
}
