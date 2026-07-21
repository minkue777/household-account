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
  const categoryId = text(raw, "categoryId", "category") ?? text(data, "category");
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

function mergeRules(input: {
  readonly canonical: readonly firestore.DocumentSnapshot[];
  readonly legacy: readonly firestore.DocumentSnapshot[];
  readonly householdId: string;
}): readonly MerchantRuleRecord[] {
  const merged = new Map<string, MerchantRuleRecord>();
  for (const snapshot of input.legacy) {
    const rule = mapMerchantRule(snapshot, input.householdId);
    if (rule !== undefined) merged.set(rule.ruleId, rule);
  }
  for (const snapshot of input.canonical) {
    const rule = mapMerchantRule(snapshot, input.householdId);
    if (rule !== undefined) merged.set(rule.ruleId, rule);
  }
  return [...merged.values()];
}

function mapCard(
  snapshot: firestore.DocumentSnapshot,
  householdId: string,
  memberIdByDisplayName: ReadonlyMap<string, string>,
): RegisteredCardCommandRecord | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (data === undefined) return undefined;
  const documentHouseholdId = text(data, "householdId") ?? householdId;
  if (documentHouseholdId !== householdId) return undefined;
  const ownerMemberId =
    text(data, "ownerMemberId") ??
    memberIdByDisplayName.get(text(data, "owner") ?? "");
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

function mergeCards(input: {
  readonly canonical: readonly firestore.DocumentSnapshot[];
  readonly legacy: readonly firestore.DocumentSnapshot[];
  readonly householdId: string;
  readonly memberIdByDisplayName: ReadonlyMap<string, string>;
}): readonly RegisteredCardCommandRecord[] {
  const merged = new Map<string, RegisteredCardCommandRecord>();
  for (const snapshot of input.legacy) {
    const card = mapCard(
      snapshot,
      input.householdId,
      input.memberIdByDisplayName,
    );
    if (card !== undefined) merged.set(card.cardId, card);
  }
  for (const snapshot of input.canonical) {
    const card = mapCard(
      snapshot,
      input.householdId,
      input.memberIdByDisplayName,
    );
    if (card !== undefined) merged.set(card.cardId, card);
  }
  return [...merged.values()];
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
  const legacyMapping = {
    ...(rule.mapping.merchant === undefined
      ? {}
      : { merchant: rule.mapping.merchant }),
    ...(rule.mapping.categoryId === undefined
      ? {}
      : { category: rule.mapping.categoryId }),
    ...(rule.mapping.memo === undefined ? {} : { memo: rule.mapping.memo }),
  };
  return {
    canonical: {
      householdId: rule.householdId,
      ruleId: rule.ruleId,
      keyword: rule.keyword,
      merchantKeyword: rule.keyword,
      normalizedKeywords: [...rule.normalizedKeywords],
      matchType: rule.matchType,
      priority:
        rule.priority === undefined ? FieldValue.delete() : rule.priority,
      mapping: { ...rule.mapping },
      active: rule.active,
      isActive: rule.active,
      aggregateVersion: rule.version,
      schemaVersion: 2,
      ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    legacy: {
      householdId: rule.householdId,
      merchantKeyword: rule.keyword,
      matchType: rule.matchType,
      exactMatch: rule.matchType === "exact",
      priority:
        rule.priority === undefined ? FieldValue.delete() : rule.priority,
      mapping: legacyMapping,
      ...(rule.mapping.categoryId === undefined
        ? { category: FieldValue.delete() }
        : { category: rule.mapping.categoryId }),
      isActive: rule.active,
      aggregateVersion: rule.version,
      schemaVersion: 1,
      ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
  };
}

function cardDocument(
  card: RegisteredCardCommandRecord,
  ownerDisplayName: string,
  created: boolean,
) {
  return {
    canonical: {
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
    },
    legacy: {
      householdId: card.householdId,
      owner: ownerDisplayName,
      ownerMemberId: card.ownerMemberId,
      cardLabel: card.cardCompanyCode,
      cardLastFour: card.lastFour ?? "",
      orderIndex: card.order,
      aggregateVersion: card.version,
      schemaVersion: 1,
      ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
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

  async transactMerchantRules(
    metadata: PaymentConfigurationCommandMetadata,
    decide: (
      current: MerchantRuleCommandState,
    ) => AtomicPaymentConfigurationMutation<
      MerchantRuleCommandState,
      MerchantRuleCommandResult
    >,
  ): Promise<PaymentConfigurationAtomicResult<MerchantRuleCommandResult>> {
    const household = this.database.collection("households").doc(metadata.householdId);
    const canonical = household.collection("merchantRules");
    const legacy = this.database.collection("merchant_rules");
    const claims = household.collection("merchantRuleClaims");
    const meta = household.collection("paymentConfigurationMeta").doc("merchant-rules");
    const receipt = receiptReference(this.database, metadata);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const [receiptSnapshot, canonicalSnapshot, legacySnapshot, metaSnapshot] =
          await Promise.all([
            transaction.get(receipt),
            transaction.get(canonical),
            transaction.get(legacy.where("householdId", "==", metadata.householdId)),
            transaction.get(meta),
          ]);
        if (receiptSnapshot.exists) {
          if (receiptSnapshot.data()?.payloadFingerprint !== metadata.payloadFingerprint) {
            return { kind: "payload-mismatch" } as const;
          }
          return {
            kind: "replayed",
            value: receiptSnapshot.data()?.result as MerchantRuleCommandResult,
          } as const;
        }

        const current = buildMerchantRuleCommandState({
          rules: mergeRules({
            canonical: canonicalSnapshot.docs,
            legacy: legacySnapshot.docs,
            householdId: metadata.householdId,
          }),
          collectionVersions: collectionVersions(metaSnapshot.data()),
        });
        const mutation = decide(current);
        if (mutation.writes) {
          const beforeRules = new Map(current.rules.map((rule) => [rule.ruleId, rule]));
          const afterRules = new Map(mutation.state.rules.map((rule) => [rule.ruleId, rule]));
          for (const [ruleId, rule] of afterRules) {
            const previous = beforeRules.get(ruleId);
            if (previous !== undefined && stable(previous) === stable(rule)) continue;
            const documents = merchantRuleDocument(rule, previous === undefined);
            transaction.set(canonical.doc(ruleId), documents.canonical, { merge: true });
            transaction.set(legacy.doc(ruleId), documents.legacy, { merge: true });
          }
          for (const ruleId of beforeRules.keys()) {
            if (!afterRules.has(ruleId)) {
              transaction.delete(canonical.doc(ruleId));
              transaction.delete(legacy.doc(ruleId));
            }
          }
          writeClaimDiff({
            transaction,
            collection: claims,
            before: merchantClaims(current),
            after: merchantClaims(mutation.state),
            document: (claim) => ({
              householdId: metadata.householdId,
              ...claim,
            }),
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
        }
        transaction.create(receipt, receiptDocument(metadata, mutation.value));
        return { kind: "committed", value: mutation.value } as const;
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
    const legacy = this.database.collection("registered_cards");
    const claims = household.collection("registeredCardClaims");
    const members = household.collection("members");
    const meta = household.collection("paymentConfigurationMeta").doc("registered-cards");
    const receipt = receiptReference(this.database, metadata);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const [
          receiptSnapshot,
          canonicalSnapshot,
          legacySnapshot,
          memberSnapshot,
          metaSnapshot,
        ] = await Promise.all([
          transaction.get(receipt),
          transaction.get(canonical),
          transaction.get(legacy.where("householdId", "==", metadata.householdId)),
          transaction.get(members),
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

        const memberIdByDisplayName = new Map<string, string>();
        const displayNameByMemberId = new Map<string, string>();
        for (const member of memberSnapshot.docs) {
          const displayName = text(member.data(), "displayName", "name");
          if (displayName !== undefined) {
            memberIdByDisplayName.set(displayName, member.id);
            displayNameByMemberId.set(member.id, displayName);
          }
        }
        const currentCards = mergeCards({
          canonical: canonicalSnapshot.docs,
          legacy: legacySnapshot.docs,
          householdId: metadata.householdId,
          memberIdByDisplayName,
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
            const ownerDisplayName =
              displayNameByMemberId.get(card.ownerMemberId) ?? card.ownerMemberId;
            const documents = cardDocument(card, ownerDisplayName, previous === undefined);
            transaction.set(canonical.doc(cardId), documents.canonical, { merge: true });
            if (card.lifecycle === "active") {
              transaction.set(legacy.doc(cardId), documents.legacy, { merge: true });
            } else {
              transaction.delete(legacy.doc(cardId));
            }
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
        }
        transaction.create(receipt, receiptDocument(metadata, mutation.value));
        return { kind: "committed", value: mutation.value } as const;
      });
    } catch (_error) {
      return { kind: "commit-failed" };
    }
  }
}
