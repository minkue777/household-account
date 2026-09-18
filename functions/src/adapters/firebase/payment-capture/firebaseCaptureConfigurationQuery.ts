import type * as firestore from "firebase-admin/firestore";

import type {
  CaptureConfigurationCard,
  CaptureConfigurationPrefetchPort,
  CaptureConfigurationQueryPort,
  CaptureConfigurationQueryResult,
  CaptureConfigurationSnapshot,
} from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/out/captureConfigurationQueryPort";
import type {
  MerchantMatchType,
  MerchantRuleCandidate,
} from "../../../contexts/payment-capture/configuration/domain/policies/merchantRuleSelection";
import {
  captureConfigurationProjectionReference,
  decodeCaptureConfigurationProjection,
  encodeCaptureConfigurationProjection,
} from "./firebaseCaptureConfigurationProjection";
import { categoryCatalogReference, readCategoryCatalogDocument } from "../categories/categoryCatalogDocument";

class CaptureConfigurationContractError extends Error {}

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
  if (value !== undefined) throw new CaptureConfigurationContractError("REGEX_NOT_SUPPORTED");
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
  if (keyword === undefined) throw new CaptureConfigurationContractError("EMPTY_KEYWORD");
  if (keyword.split(",").some((token) => token.trim() === "")) throw new CaptureConfigurationContractError("EMPTY_OR_TOKEN");
  const mappingValue =
    typeof data.mapping === "object" && data.mapping !== null
      ? (data.mapping as FirebaseFirestore.DocumentData)
      : {};
  const type = matchType(data);
  const category = mappingValue.categoryId ?? mappingValue.category ?? data.categoryId ?? data.category;
  if (category !== undefined && (typeof category !== "string" || category.trim() === "")) throw new CaptureConfigurationContractError("INVALID_CATEGORY_REFERENCE");
  if (data.priority !== undefined && (!Number.isSafeInteger(data.priority) || data.priority <= 0)) throw new CaptureConfigurationContractError("INVALID_PRIORITY");
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
  const owner = text(data, "ownerMemberId");
  if (companyLabel === undefined || owner === undefined) return undefined;
  return {
    cardId: document.id,
    ownerMemberId: owner,
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

function configurationKey(input: {
  readonly householdId: string;
  readonly actingMemberId: string;
}): string {
  return `${input.householdId}\u0000${input.actingMemberId}`;
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
      const projection = captureConfigurationProjectionReference(
        this.database,
        input.householdId,
      );
      const projected = decodeCaptureConfigurationProjection(
        input.householdId,
        (await projection.get()).data(),
      );
      if (projected !== undefined) {
        return { kind: "available" as const, value: projected };
      }

      const value = await this.database.runTransaction(
        async (transaction): Promise<CaptureConfigurationSnapshot> => {
          const concurrentProjection = decodeCaptureConfigurationProjection(
            input.householdId,
            (await transaction.get(projection)).data(),
          );
          if (concurrentProjection !== undefined) return concurrentProjection;

          const [catalogSnapshot, canonicalCards, canonicalRules] = await Promise.all([
            transaction.get(categoryCatalogReference(this.database, input.householdId)),
            transaction.get(household.collection("registeredCards")),
            transaction.get(household.collection("merchantRules")),
          ]);
          const cards = canonicalCards.docs.flatMap((document) => {
            const card = mapCard(document, input.householdId);
            return card === undefined ? [] : [card];
          });
          const merchantRules = canonicalRules.docs.flatMap((document) => {
            const rule = mapRule(document, input.householdId);
            return rule === undefined ? [] : [rule];
          });
          const catalog = readCategoryCatalogDocument(catalogSnapshot.data(), input.householdId);
          const activeCategoryIds = new Set(catalog.categories
            .filter((category) => category.state === "active")
            .map((category) => category.categoryId));
          for (const [alias, categoryId] of Object.entries(catalog.categoryAliases)) {
            if (activeCategoryIds.has(categoryId)) activeCategoryIds.add(alias);
          }
          const defaultCategoryId = catalog.defaultCategoryId ?? undefined;
          const rebuilt: CaptureConfigurationSnapshot = {
            cards,
            merchantRules,
            activeCategoryIds,
            ...(defaultCategoryId === undefined
              ? {}
              : { defaultCategoryId }),
          };
          transaction.set(
            projection,
            encodeCaptureConfigurationProjection(input.householdId, rebuilt),
          );
          return rebuilt;
        },
      );
      return { kind: "available" as const, value };
    } catch (error) {
      if (error instanceof CaptureConfigurationContractError) return { kind: "contract-failure" as const, code: error.message };
      return {
        kind: "retryable-failure" as const,
        code: "PAYMENT_CONFIGURATION_UNAVAILABLE" as const,
      };
    }
  }
}

/**
 * 같은 인스턴스에서 동시에 시작된 동일 설정 조회를 한 Promise로 합칩니다.
 * Android raw parser가 먼저 조회를 시작하고 transaction gateway가 같은 결과를
 * 기다리므로 receipt claim과 설정 조회가 병렬로 진행됩니다.
 * 완료된 결과는 보관하지 않아 다음 요청이 설정 변경의 projection 무효화를 봅니다.
 */
export class CoalescingCaptureConfigurationQuery
  implements CaptureConfigurationQueryPort, CaptureConfigurationPrefetchPort
{
  private readonly inFlight = new Map<
    string,
    Promise<CaptureConfigurationQueryResult>
  >();

  constructor(private readonly delegate: CaptureConfigurationQueryPort) {}

  prefetch(input: {
    readonly householdId: string;
    readonly actingMemberId: string;
  }): void {
    void this.load(input).catch(() => undefined);
  }

  load(input: {
    readonly householdId: string;
    readonly actingMemberId: string;
  }): Promise<CaptureConfigurationQueryResult> {
    const key = configurationKey(input);
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;

    const started = this.delegate.load(input);
    this.inFlight.set(key, started);
    void started.then(
      () => {
        if (this.inFlight.get(key) === started) this.inFlight.delete(key);
      },
      () => {
        if (this.inFlight.get(key) === started) this.inFlight.delete(key);
      },
    );
    return started;
  }
}
