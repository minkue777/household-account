import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  AtomicPaymentConfigurationMutation,
  PaymentConfigurationAtomicResult,
  PaymentConfigurationAtomicStorePort,
  PaymentConfigurationCommandMetadata,
} from "../../../contexts/payment-capture/configuration/application/ports/out/paymentConfigurationAtomicStorePort";
import type {
  MerchantRuleCommandResult,
  MerchantRuleCommandState,
  MerchantRuleMapping,
  MerchantRuleRecord,
} from "../../../contexts/payment-capture/configuration/application/ports/in/merchantRuleCommandInputPort";
import type {
  RegisteredCardCommandRecord,
  RegisteredCardCommandResult,
  RegisteredCardCommandState,
} from "../../../contexts/payment-capture/configuration/application/ports/in/registeredCardCommandBoundaryInputPort";
import { buildMerchantRuleCommandState } from "../../../contexts/payment-capture/configuration/domain/policies/merchantRuleClaims";
import { normalizedMerchantKeywordTokens } from "../../../contexts/payment-capture/configuration/domain/value-objects/merchantKeyword";
import { normalizeCardCompanyKey } from "../../../contexts/payment-capture/configuration/domain/value-objects/cardIdentity";
import { firestoreTtlAfter } from "../shared/firestoreTtl";
import { invalidateCaptureConfigurationProjection } from "../payment-capture/firebaseCaptureConfigurationProjection";

const RECEIPT_CONTEXT = "payment-configuration";
const RECEIPT_RETENTION_MILLIS = 30 * 24 * 60 * 60 * 1_000;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

function text(
  data: FirebaseFirestore.DocumentData | undefined,
  ...fields: string[]
): string | undefined {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function number(
  data: FirebaseFirestore.DocumentData | undefined,
  fallback: number,
  ...fields: string[]
): number {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function boolean(
  data: FirebaseFirestore.DocumentData | undefined,
  fallback: boolean,
  ...fields: string[]
): boolean {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "boolean") return value;
  }
  return fallback;
}

function merchantMapping(
  data: FirebaseFirestore.DocumentData | undefined,
): MerchantRuleMapping {
  const raw =
    typeof data?.mapping === "object" &&
    data.mapping !== null &&
    !Array.isArray(data.mapping)
      ? (data.mapping as Record<string, unknown>)
      : {};
  const merchant = text(raw, "merchant");
  const categoryId = text(raw, "categoryId", "category") ?? text(data, "categoryId", "category");
  const memo = text(raw, "memo");
  return {
    ...(merchant === undefined ? {} : { merchant }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(memo === undefined ? {} : { memo }),
  };
}

function mapMerchantRule(
  snapshot: firestore.DocumentSnapshot,
  householdId: string,
): MerchantRuleRecord | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (data === undefined) return undefined;
  const documentHouseholdId = text(data, "householdId") ?? householdId;
  if (documentHouseholdId !== householdId) return undefined;
  const keyword = text(data, "keyword", "merchantKeyword");
  if (keyword === undefined) return undefined;
  const storedMatchType = text(data, "matchType");
  const matchType =
    storedMatchType === "exact" ||
    storedMatchType === "startsWith" ||
    storedMatchType === "endsWith" ||
    storedMatchType === "contains"
      ? storedMatchType
      : data.exactMatch === true
        ? "exact"
        : "contains";
  const priority =
    matchType === "exact" ? undefined : number(data, 0, "priority");
  return {
    ruleId: snapshot.id,
    householdId,
    keyword,
    normalizedKeywords: normalizedMerchantKeywordTokens(keyword),
    matchType,
    ...(priority === undefined ? {} : { priority }),
    active: boolean(data, true, "active", "isActive"),
    mapping: merchantMapping(data),
    version: Math.max(1, number(data, 1, "aggregateVersion", "version")),
  };
}

function mapCard(
  snapshot: firestore.DocumentSnapshot,
  householdId: string,
): RegisteredCardCommandRecord | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (data === undefined) return undefined;
  const documentHouseholdId = text(data, "householdId") ?? householdId;
  if (documentHouseholdId !== householdId) return undefined;
  const ownerMemberId = text(data, "ownerMemberId");
  const cardCompanyCode = text(data, "cardCompanyCode", "cardCompany", "cardLabel");
  if (ownerMemberId === undefined || cardCompanyCode === undefined) return undefined;
  const lastFour = text(data, "lastFour", "cardLastFour");
  const lifecycle =
    text(data, "lifecycle", "lifecycleState") === "retired" ||
    data.deletedAt !== undefined
      ? "retired"
      : "active";
  return {
    cardId: snapshot.id,
    householdId,
    ownerMemberId,
    cardCompanyCode,
    ...(lastFour === undefined ? {} : { lastFour }),
    order: number(data, 0, "order", "orderIndex"),
    version: Math.max(1, number(data, 1, "aggregateVersion", "version")),
    lifecycle,
  };
}

function collectionVersions(
  data: FirebaseFirestore.DocumentData | undefined,
): Readonly<Record<string, number>> {
  const raw = data?.collectionVersions;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" &&
        Number.isSafeInteger(entry[1]) &&
        entry[1] >= 0,
    ),
  );
}

function merchantRuleDocument(rule: MerchantRuleRecord, created: boolean) {
  return {
    householdId: rule.householdId,
    ruleId: rule.ruleId,
    keyword: rule.keyword,
    normalizedKeywords: [...rule.normalizedKeywords],
    matchType: rule.matchType,
    priority:
      rule.priority === undefined ? FieldValue.delete() : rule.priority,
    mapping: { ...rule.mapping },
    // 이전 canonical 문서의 별칭도 정리해 제거한 치환이 남지 않게 합니다.
    category: FieldValue.delete(),
    categoryId: FieldValue.delete(),
    merchantKeyword: FieldValue.delete(),
    isActive: FieldValue.delete(),
    active: rule.active,
    aggregateVersion: rule.version,
    schemaVersion: 2,
    ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function cardDocument(
  card: RegisteredCardCommandRecord,
  created: boolean,
) {
  return {
    householdId: card.householdId,
    cardId: card.cardId,
    ownerMemberId: card.ownerMemberId,
    cardCompanyCode: card.cardCompanyCode,
    lastFour: card.lastFour ?? "",
    order: card.order,
    lifecycle: card.lifecycle,
    aggregateVersion: card.version,
    schemaVersion: 2,
    ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function receiptReference(
  database: firestore.Firestore,
  metadata: PaymentConfigurationCommandMetadata,
) {
  return database
    .collection("commandReceipts")
    .doc(RECEIPT_CONTEXT)
    .collection("receipts")
    .doc(hash(`${metadata.householdId}\u0000${metadata.idempotencyKey}`));
}

function receiptDocument(
  metadata: PaymentConfigurationCommandMetadata,
  result: unknown,
) {
  const occurred = Date.parse(metadata.occurredAt);
  return {
    householdId: metadata.householdId,
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

type MerchantClaim =
  | { readonly kind: "exact"; readonly token: string; readonly ruleId: string }
  | {
      readonly kind: "priority";
      readonly matchType: string;
      readonly priority: number;
      readonly ruleId: string;
    };

function merchantClaims(state: MerchantRuleCommandState): Map<string, MerchantClaim> {
  const claims = new Map<string, MerchantClaim>();
  for (const claim of state.exactKeywordClaims) {
    claims.set(hash(`exact\u0000${claim.token}`), { kind: "exact", ...claim });
  }
  for (const claim of state.priorityClaims) {
    claims.set(hash(`priority\u0000${claim.matchType}\u0000${claim.priority}`), {
      kind: "priority",
      ...claim,
    });
  }
  return claims;
}

function cardClaims(state: RegisteredCardCommandState): Map<string, RegisteredCardCommandState["claims"][number]> {
  return new Map(
    state.claims.map((claim) => [
      hash(
        `${claim.ownerMemberId}\u0000${normalizeCardCompanyKey(
          claim.cardCompanyCode,
        )}\u0000${claim.lastFour ?? ""}`,
      ),
      claim,
    ]),
  );
}

function writeClaimDiff<T>(input: {
  readonly transaction: firestore.Transaction;
  readonly collection: firestore.CollectionReference;
  readonly before: ReadonlyMap<string, T>;
  readonly after: ReadonlyMap<string, T>;
  readonly document: (claim: T) => Readonly<Record<string, unknown>>;
}): void {
  for (const [claimId, claim] of input.after) {
    const previous = input.before.get(claimId);
    const reference = input.collection.doc(claimId);
    if (previous === undefined) {
      input.transaction.create(reference, {
        ...input.document(claim),
        schemaVersion: 1,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else if (stable(previous) !== stable(claim)) {
      input.transaction.set(
        reference,
        {
          ...input.document(claim),
          schemaVersion: 1,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }
  for (const claimId of input.before.keys()) {
    if (!input.after.has(claimId)) {
      input.transaction.delete(input.collection.doc(claimId));
    }
  }
}

export class FirebasePaymentConfigurationAtomicStore
  implements PaymentConfigurationAtomicStorePort
{
  constructor(private readonly database: firestore.Firestore) {}

  async prepareMerchantRules(
    transaction: firestore.Transaction,
    householdId: string,
    decide: (current: MerchantRuleCommandState) => AtomicPaymentConfigurationMutation<MerchantRuleCommandState, MerchantRuleCommandResult>,
  ): Promise<{ value: MerchantRuleCommandResult; stage: () => void }> {
    const household = this.database.collection("households").doc(householdId);
    const canonical = household.collection("merchantRules");
    const claims = household.collection("merchantRuleClaims");
    const meta = household.collection("paymentConfigurationMeta").doc("merchant-rules");
    const [canonicalSnapshot, metaSnapshot] = await Promise.all([
      transaction.get(canonical),
      transaction.get(meta),
    ]);
    const current = buildMerchantRuleCommandState({
      rules: canonicalSnapshot.docs.flatMap((document) => {
        const rule = mapMerchantRule(document, householdId);
        return rule === undefined ? [] : [rule];
      }),
      collectionVersions: collectionVersions(metaSnapshot.data()),
    });
    const mutation = decide(current);
    return { value: mutation.value, stage: () => {
        if (mutation.writes) {
          const beforeRules = new Map(current.rules.map((rule) => [rule.ruleId, rule]));
          const afterRules = new Map(mutation.state.rules.map((rule) => [rule.ruleId, rule]));
          for (const [ruleId, rule] of afterRules) {
            const previous = beforeRules.get(ruleId);
            if (previous !== undefined && stable(previous) === stable(rule)) continue;
            const document = merchantRuleDocument(rule, previous === undefined);
            // mapping은 이미 부분 수정 정책을 적용한 최종 상태입니다. nested merge로
            // 저장하면 제거한 치환 필드가 남으므로 이 top-level 필드 전체를 교체합니다.
            transaction.set(canonical.doc(ruleId), document, { mergeFields: Object.keys(document) });
          }
          for (const ruleId of beforeRules.keys()) {
            if (!afterRules.has(ruleId)) {
              transaction.delete(canonical.doc(ruleId));
            }
          }
          writeClaimDiff({
            transaction,
            collection: claims,
            before: merchantClaims(current),
            after: merchantClaims(mutation.state),
            document: (claim) => ({
              householdId: householdId,
              ...claim,
            }),
          });
          transaction.set(
            meta,
            {
              householdId: householdId,
              collectionVersions: mutation.state.collectionVersions,
              schemaVersion: 1,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          invalidateCaptureConfigurationProjection(
            transaction,
            this.database,
            householdId,
          );
        }

    } };
  }

  async transactMerchantRules(
    metadata: PaymentConfigurationCommandMetadata,
    decide: (current: MerchantRuleCommandState) => AtomicPaymentConfigurationMutation<MerchantRuleCommandState, MerchantRuleCommandResult>,
  ): Promise<PaymentConfigurationAtomicResult<MerchantRuleCommandResult>> {
    const receipt = receiptReference(this.database, metadata);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const receiptSnapshot = await transaction.get(receipt);
        if (receiptSnapshot.exists) {
          if (receiptSnapshot.data()?.payloadFingerprint !== metadata.payloadFingerprint) return { kind: "payload-mismatch" } as const;
          return { kind: "replayed", value: receiptSnapshot.data()?.result as MerchantRuleCommandResult } as const;
        }
        const prepared = await this.prepareMerchantRules(transaction, metadata.householdId, decide);
        prepared.stage();
        transaction.create(receipt, receiptDocument(metadata, prepared.value));
        return { kind: "committed", value: prepared.value } as const;
      });
    } catch (_error) { return { kind: "commit-failed" }; }
  }

  async transactRegisteredCardUpdate(
    metadata: PaymentConfigurationCommandMetadata,
    cardId: string,
    decide: (
      current: RegisteredCardCommandState,
    ) => AtomicPaymentConfigurationMutation<
      RegisteredCardCommandState,
      RegisteredCardCommandResult
    >,
  ): Promise<PaymentConfigurationAtomicResult<RegisteredCardCommandResult>> {
    const household = this.database.collection("households").doc(metadata.householdId);
    const canonical = household.collection("registeredCards");
    const claims = household.collection("registeredCardClaims");
    const receipt = receiptReference(this.database, metadata);
    const canonicalCard = canonical.doc(cardId);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const [
          receiptSnapshot,
          canonicalSnapshot,
        ] = await transaction.getAll(
          receipt,
          canonicalCard,
        );
        if (receiptSnapshot.exists) {
          if (receiptSnapshot.data()?.payloadFingerprint !== metadata.payloadFingerprint) {
            return { kind: "payload-mismatch" } as const;
          }
          return {
            kind: "replayed",
            value: receiptSnapshot.data()?.result as RegisteredCardCommandResult,
          } as const;
        }

        const card = mapCard(canonicalSnapshot, metadata.householdId);
        const currentCards = card === undefined ? [] : [card];
        const current: RegisteredCardCommandState = {
          cards: currentCards,
          claims: currentCards
            .filter(({ lifecycle }) => lifecycle === "active")
            .map((card) => ({
              householdId: card.householdId,
              ownerMemberId: card.ownerMemberId,
              cardCompanyCode: card.cardCompanyCode,
              ...(card.lastFour === undefined ? {} : { lastFour: card.lastFour }),
              cardId: card.cardId,
            })),
          historicalEvidence: [],
          collectionVersions: {},
        };
        const mutation = decide(current);
        let value = mutation.value;

        if (mutation.writes) {
          const previous = current.cards.find((card) => card.cardId === cardId);
          const updated = mutation.state.cards.find((card) => card.cardId === cardId);
          if (
            previous === undefined ||
            updated === undefined ||
            mutation.state.cards.some((card) => card.cardId !== cardId)
          ) {
            throw new Error("TARGETED_CARD_MUTATION_SCOPE_VIOLATION");
          }

          const beforeClaims = cardClaims(current);
          const afterClaims = cardClaims(mutation.state);
          const beforeClaim = [...beforeClaims.entries()][0];
          const afterClaim = [...afterClaims.entries()][0];
          let nextClaimSnapshot: firestore.DocumentSnapshot | undefined;
          if (afterClaim !== undefined && afterClaim[0] !== beforeClaim?.[0]) {
            nextClaimSnapshot = await transaction.get(claims.doc(afterClaim[0]));
            if (
              nextClaimSnapshot.exists &&
              text(nextClaimSnapshot.data(), "cardId") !== cardId
            ) {
              value = { kind: "Conflict", code: "DUPLICATE_CARD" };
              transaction.create(receipt, receiptDocument(metadata, value));
              return { kind: "committed", value } as const;
            }
          }

          transaction.set(canonicalCard, cardDocument(updated, false), { merge: true });

          if (beforeClaim !== undefined && beforeClaim[0] !== afterClaim?.[0]) {
            transaction.delete(claims.doc(beforeClaim[0]));
          }
          if (afterClaim !== undefined && afterClaim[0] !== beforeClaim?.[0]) {
            const reference = claims.doc(afterClaim[0]);
            const claimDocument = {
              ...afterClaim[1],
              schemaVersion: 1,
            };
            if (nextClaimSnapshot?.exists === true) {
              transaction.set(
                reference,
                { ...claimDocument, updatedAt: FieldValue.serverTimestamp() },
                { merge: true },
              );
            } else {
              transaction.create(reference, {
                ...claimDocument,
                createdAt: FieldValue.serverTimestamp(),
              });
            }
          }
          invalidateCaptureConfigurationProjection(
            transaction,
            this.database,
            metadata.householdId,
          );
        }
        transaction.create(receipt, receiptDocument(metadata, value));
        return { kind: "committed", value } as const;
      });
    } catch (_error) {
      return { kind: "commit-failed" };
    }
  }

  async transactRegisteredCards(
    metadata: PaymentConfigurationCommandMetadata,
    decide: (
      current: RegisteredCardCommandState,
    ) => AtomicPaymentConfigurationMutation<
      RegisteredCardCommandState,
      RegisteredCardCommandResult
    >,
  ): Promise<PaymentConfigurationAtomicResult<RegisteredCardCommandResult>> {
    const household = this.database.collection("households").doc(metadata.householdId);
    const canonical = household.collection("registeredCards");
    const claims = household.collection("registeredCardClaims");
    const meta = household.collection("paymentConfigurationMeta").doc("registered-cards");
    const receipt = receiptReference(this.database, metadata);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const [
          receiptSnapshot,
          canonicalSnapshot,
          metaSnapshot,
        ] = await Promise.all([
          transaction.get(receipt),
          transaction.get(canonical),
          transaction.get(meta),
        ]);
        if (receiptSnapshot.exists) {
          if (receiptSnapshot.data()?.payloadFingerprint !== metadata.payloadFingerprint) {
            return { kind: "payload-mismatch" } as const;
          }
          return {
            kind: "replayed",
            value: receiptSnapshot.data()?.result as RegisteredCardCommandResult,
          } as const;
        }

        const currentCards = canonicalSnapshot.docs.flatMap((document) => {
          const card = mapCard(document, metadata.householdId);
          return card === undefined ? [] : [card];
        });
        const current: RegisteredCardCommandState = {
          cards: currentCards,
          claims: currentCards
            .filter(({ lifecycle }) => lifecycle === "active")
            .map((card) => ({
              householdId: card.householdId,
              ownerMemberId: card.ownerMemberId,
              cardCompanyCode: card.cardCompanyCode,
              ...(card.lastFour === undefined ? {} : { lastFour: card.lastFour }),
              cardId: card.cardId,
            })),
          historicalEvidence: [],
          collectionVersions: collectionVersions(metaSnapshot.data()),
        };
        const mutation = decide(current);
        if (mutation.writes) {
          const beforeCards = new Map(current.cards.map((card) => [card.cardId, card]));
          const afterCards = new Map(mutation.state.cards.map((card) => [card.cardId, card]));
          for (const [cardId, card] of afterCards) {
            const previous = beforeCards.get(cardId);
            if (previous !== undefined && stable(previous) === stable(card)) continue;
            transaction.set(canonical.doc(cardId), cardDocument(card, previous === undefined), { merge: true });
          }
          writeClaimDiff({
            transaction,
            collection: claims,
            before: cardClaims(current),
            after: cardClaims(mutation.state),
            document: (claim) => ({ ...claim }),
          });
          transaction.set(
            meta,
            {
              householdId: metadata.householdId,
              collectionVersions: mutation.state.collectionVersions,
              schemaVersion: 1,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          invalidateCaptureConfigurationProjection(
            transaction,
            this.database,
            metadata.householdId,
          );
        }
        transaction.create(receipt, receiptDocument(metadata, mutation.value));
        return { kind: "committed", value: mutation.value } as const;
      });
    } catch (_error) {
      return { kind: "commit-failed" };
    }
  }
}
