import type * as firestore from "firebase-admin/firestore";

import { BoundedTtlCache } from "../../memory/boundedTtlCache";
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
  memberIdByAlias: ReadonlyMap<string, string>,
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
  const canonicalOwner = memberIdByAlias.get(owner) ?? owner;
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

export const CAPTURE_CONFIGURATION_CACHE_TTL_MILLIS = 60 * 1_000;
export const CAPTURE_CONFIGURATION_CACHE_MAX_ENTRIES = 32;

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

          const [
            householdSnapshot,
            memberSnapshots,
            categorySetting,
            canonicalCards,
            legacyCards,
            canonicalRules,
            legacyRules,
            canonicalCategories,
            legacyCategories,
          ] = await Promise.all([
            transaction.get(household),
            transaction.get(household.collection("members")),
            transaction.get(
              household.collection("categorySettings").doc("default"),
            ),
            transaction.get(household.collection("registeredCards")),
            transaction.get(
              this.database
                .collection("registered_cards")
                .where("householdId", "==", input.householdId),
            ),
            transaction.get(household.collection("merchantRules")),
            transaction.get(
              this.database
                .collection("merchant_rules")
                .where("householdId", "==", input.householdId),
            ),
            transaction.get(household.collection("categories")),
            transaction.get(
              this.database
                .collection("categories")
                .where("householdId", "==", input.householdId),
            ),
          ]);

          const memberIdByAlias = new Map<string, string>();
          for (const member of memberSnapshots.docs) {
            memberIdByAlias.set(member.id, member.id);
            const displayName = text(member.data(), "displayName", "name");
            if (displayName !== undefined) {
              memberIdByAlias.set(displayName, member.id);
            }
          }
          memberIdByAlias.set(input.actingMemberId, input.actingMemberId);

          const cards = unionById(
            legacyCards.docs.flatMap((document) => {
              const card = mapCard(
                document,
                input.householdId,
                memberIdByAlias,
              );
              return card === undefined ? [] : [[document.id, card] as const];
            }),
            canonicalCards.docs.flatMap((document) => {
              const card = mapCard(
                document,
                input.householdId,
                memberIdByAlias,
              );
              return card === undefined ? [] : [[document.id, card] as const];
            }),
          );
          const merchantRules = unionById(
            legacyRules.docs.flatMap((document) => {
              const rule = mapRule(document, input.householdId);
              return rule === undefined ? [] : [[document.id, rule] as const];
            }),
            canonicalRules.docs.flatMap((document) => {
              const rule = mapRule(document, input.householdId);
              return rule === undefined ? [] : [[document.id, rule] as const];
            }),
          );

          const activeCategoryIds = new Set<string>();
          for (const document of [
            ...legacyCategories.docs,
            ...canonicalCategories.docs,
          ]) {
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
            text(
              categorySetting.data(),
              "defaultCategoryId",
              "categoryId",
              "value",
            ) ??
            text(
              householdSnapshot.data(),
              "defaultCategoryId",
              "defaultCategoryKey",
            ) ??
            (activeCategoryIds.has("etc") ? "etc" : undefined);
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
    } catch {
      return {
        kind: "retryable-failure" as const,
        code: "PAYMENT_CONFIGURATION_UNAVAILABLE" as const,
      };
    }
  }
}

/**
 * 카드·가맹점 규칙·카테고리의 여러 Firestore 조회 결과를 warm instance에서 잠시
 * 재사용합니다. 실패 결과는 캐시하지 않아 복구를 지연시키지 않습니다.
 */
export class CachedCaptureConfigurationQuery
  implements CaptureConfigurationQueryPort
{
  private readonly cache: BoundedTtlCache<
    string,
    Extract<CaptureConfigurationQueryResult, { readonly kind: "available" }>
  >;

  constructor(
    private readonly delegate: CaptureConfigurationQueryPort,
    options: {
      readonly ttlMillis?: number;
      readonly maxEntries?: number;
      readonly now?: () => number;
    } = {},
  ) {
    this.cache = new BoundedTtlCache({
      ttlMillis:
        options.ttlMillis ?? CAPTURE_CONFIGURATION_CACHE_TTL_MILLIS,
      maxEntries:
        options.maxEntries ?? CAPTURE_CONFIGURATION_CACHE_MAX_ENTRIES,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  async load(input: {
    readonly householdId: string;
    readonly actingMemberId: string;
  }): Promise<CaptureConfigurationQueryResult> {
    const key = configurationKey(input);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const loaded = await this.delegate.load(input);
    if (loaded.kind === "available") this.cache.set(key, loaded);
    return loaded;
  }
}

/**
 * 같은 인스턴스에서 동시에 시작된 동일 설정 조회를 한 Promise로 합칩니다.
 * Android raw parser가 먼저 조회를 시작하고 transaction gateway가 같은 결과를
 * 기다리므로 receipt claim과 설정 조회가 병렬로 진행됩니다.
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
