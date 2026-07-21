import type * as firestore from "firebase-admin/firestore";

import type {
  CaptureConfigurationCard,
  CaptureConfigurationQueryPort,
  CaptureConfigurationSnapshot,
} from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/out/captureConfigurationQueryPort";
import type {
  MerchantMatchType,
  MerchantRuleCandidate,
} from "../../../contexts/payment-capture/configuration/domain/policies/merchantRuleSelection";

function text(
  data: FirebaseFirestore.DocumentData | undefined,
  ...fields: readonly string[]
): string | undefined {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function matchType(data: FirebaseFirestore.DocumentData): MerchantMatchType {
  const value = data.matchType;
  if (
    value === "exact" ||
    value === "startsWith" ||
    value === "endsWith" ||
    value === "contains"
  ) {
    return value;
  }
  return data.exactMatch === true ? "exact" : "contains";
}

function mapRule(
  document: firestore.QueryDocumentSnapshot,
  householdId: string,
): MerchantRuleCandidate | undefined {
  const data = document.data();
  if (text(data, "householdId") !== undefined && text(data, "householdId") !== householdId) {
    return undefined;
  }
  const keyword = text(data, "keyword", "merchantKeyword");
  if (keyword === undefined) return undefined;
  const mappingValue =
    typeof data.mapping === "object" && data.mapping !== null
      ? (data.mapping as FirebaseFirestore.DocumentData)
      : {};
  const type = matchType(data);
  const priority =
    typeof data.priority === "number" && Number.isSafeInteger(data.priority)
      ? data.priority
      : undefined;
  const mappedMerchant = text(mappingValue, "merchant");
  const mappedCategory =
    text(mappingValue, "categoryId", "category") ??
    text(data, "categoryId", "category");
  const mappedMemo = text(mappingValue, "memo");
  return {
    ruleId: document.id,
    keyword,
    matchType: type,
    ...(priority === undefined ? {} : { priority }),
    active:
      data.active !== false &&
      data.isActive !== false &&
      data.lifecycleState !== "retired" &&
      data.lifecycle !== "retired",
    mapping: {
      ...(mappedMerchant === undefined ? {} : { merchant: mappedMerchant }),
      ...(mappedCategory === undefined ? {} : { categoryId: mappedCategory }),
      ...(mappedMemo === undefined ? {} : { memo: mappedMemo }),
    },
  };
}

function mapCard(
  document: firestore.QueryDocumentSnapshot,
  householdId: string,
  actingMemberId: string,
  ownerAliases: ReadonlySet<string>,
): CaptureConfigurationCard | undefined {
  const data = document.data();
  if (text(data, "householdId") !== undefined && text(data, "householdId") !== householdId) {
    return undefined;
  }
  const companyLabel = text(
    data,
    "companyLabel",
    "cardCompanyCode",
    "cardCompany",
    "cardLabel",
  );
  const owner = text(data, "ownerMemberId", "ownerId", "owner");
  if (companyLabel === undefined || owner === undefined) return undefined;
  const canonicalOwner = ownerAliases.has(owner) ? actingMemberId : owner;
  return {
    cardId: document.id,
    ownerMemberId: canonicalOwner,
    companyLabel,
    ...(text(data, "lastFour", "cardLastFour") === undefined
      ? {}
      : { lastFour: text(data, "lastFour", "cardLastFour") }),
    lifecycleState:
      data.lifecycleState === "retired" ||
      data.lifecycle === "retired" ||
      data.active === false
        ? "retired"
        : "active",
  };
}

function unionById<T>(
  legacy: readonly (readonly [string, T])[],
  canonical: readonly (readonly [string, T])[],
): readonly T[] {
  return [...new Map([...legacy, ...canonical]).values()];
}

export class FirebaseCaptureConfigurationQuery
  implements CaptureConfigurationQueryPort
{
  constructor(private readonly database: firestore.Firestore) {}

  async load(input: {
    readonly householdId: string;
    readonly actingMemberId: string;
  }) {
    try {
      const household = this.database.collection("households").doc(input.householdId);
      const [
        householdSnapshot,
        memberSnapshot,
        categorySetting,
        canonicalCards,
        legacyCards,
        canonicalRules,
        legacyRules,
        canonicalCategories,
        legacyCategories,
      ] = await Promise.all([
        household.get(),
        household.collection("members").doc(input.actingMemberId).get(),
        household.collection("categorySettings").doc("default").get(),
        household.collection("registeredCards").get(),
        this.database
          .collection("registered_cards")
          .where("householdId", "==", input.householdId)
          .get(),
        household.collection("merchantRules").get(),
        this.database
          .collection("merchant_rules")
          .where("householdId", "==", input.householdId)
          .get(),
        household.collection("categories").get(),
        this.database
          .collection("categories")
          .where("householdId", "==", input.householdId)
          .get(),
      ]);

      const ownerAliases = new Set<string>([input.actingMemberId]);
      const displayName = text(memberSnapshot.data(), "displayName", "name");
      if (displayName !== undefined) ownerAliases.add(displayName);

      const cards = unionById(
        legacyCards.docs.flatMap((document) => {
          const value = mapCard(
            document,
            input.householdId,
            input.actingMemberId,
            ownerAliases,
          );
          return value === undefined ? [] : [[document.id, value] as const];
        }),
        canonicalCards.docs.flatMap((document) => {
          const value = mapCard(
            document,
            input.householdId,
            input.actingMemberId,
            ownerAliases,
          );
          return value === undefined ? [] : [[document.id, value] as const];
        }),
      );
      const merchantRules = unionById(
        legacyRules.docs.flatMap((document) => {
          const value = mapRule(document, input.householdId);
          return value === undefined ? [] : [[document.id, value] as const];
        }),
        canonicalRules.docs.flatMap((document) => {
          const value = mapRule(document, input.householdId);
          return value === undefined ? [] : [[document.id, value] as const];
        }),
      );

      const activeCategoryIds = new Set<string>();
      for (const document of [...legacyCategories.docs, ...canonicalCategories.docs]) {
        const data = document.data();
        if (
          data.lifecycleState === "archived" ||
          data.lifecycleState === "deleted" ||
          data.lifecycle === "archived" ||
          data.lifecycle === "deleted" ||
          data.isActive === false
        ) {
          continue;
        }
        activeCategoryIds.add(document.id);
        const id = text(data, "categoryId", "key");
        if (id !== undefined) activeCategoryIds.add(id);
      }

      const defaultCategoryId =
        text(categorySetting.data(), "defaultCategoryId", "categoryId", "value") ??
        text(householdSnapshot.data(), "defaultCategoryId", "defaultCategoryKey") ??
        (activeCategoryIds.has("etc") ? "etc" : undefined);
      const value: CaptureConfigurationSnapshot = {
        cards,
        merchantRules,
        activeCategoryIds,
        ...(defaultCategoryId === undefined ? {} : { defaultCategoryId }),
      };
      return { kind: "available" as const, value };
    } catch {
      return {
        kind: "retryable-failure" as const,
        code: "PAYMENT_CONFIGURATION_UNAVAILABLE" as const,
      };
    }
  }
}
