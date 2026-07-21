import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  HomePreferenceAtomicResult,
  HomePreferenceAtomicStorePort,
  HomePreferenceCommandMetadata,
  HomePreferenceCommandState,
  HomePreferenceMutation,
} from "../../../platform/home-preferences/application/ports/out/homePreferenceAtomicStorePort";
import type { HomeCardType } from "../../../platform/home-preferences/domain/homeSummary";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const RECEIPT_CONTEXT = "home-preferences";
const RETENTION_MILLIS = 30 * 24 * 60 * 60 * 1_000;

const WEB_TO_CANONICAL: Readonly<Record<string, HomeCardType>> = Object.freeze({
  localCurrencyBalance: "LOCAL_CURRENCY_BALANCE",
  monthlyRemainingBudget: "MONTHLY_REMAINING_BUDGET",
  monthlySpent: "MONTHLY_EXPENSE",
  yearlySpent: "YEARLY_EXPENSE",
});

const CANONICAL_TO_WEB = Object.freeze({
  LOCAL_CURRENCY_BALANCE: "localCurrencyBalance",
  MONTHLY_REMAINING_BUDGET: "monthlyRemainingBudget",
  MONTHLY_EXPENSE: "monthlySpent",
  YEARLY_EXPENSE: "yearlySpent",
} as const satisfies Readonly<Record<HomeCardType, string>>);

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
  }
  return fallback;
}

function canonicalCard(value: unknown, fallback: HomeCardType): HomeCardType {
  if (
    value === "LOCAL_CURRENCY_BALANCE" ||
    value === "MONTHLY_REMAINING_BUDGET" ||
    value === "MONTHLY_EXPENSE" ||
    value === "YEARLY_EXPENSE"
  ) {
    return value;
  }
  return typeof value === "string" ? WEB_TO_CANONICAL[value] ?? fallback : fallback;
}

function currentState(input: {
  readonly householdId: string;
  readonly canonical: firestore.DocumentSnapshot;
  readonly household: firestore.DocumentSnapshot;
}): HomePreferenceCommandState {
  const canonical = input.canonical.data();
  const household = input.household.data();
  const legacyConfig =
    typeof household?.homeSummaryConfig === "object" &&
    household.homeSummaryConfig !== null &&
    !Array.isArray(household.homeSummaryConfig)
      ? (household.homeSummaryConfig as Record<string, unknown>)
      : {};
  const selected =
    text(canonical, "selectedLocalCurrencyType") ??
    text(household, "selectedLocalCurrencyType", "selectedLocalCurrencyTypeId");
  return {
    householdId: input.householdId,
    left: canonicalCard(
      canonical?.left ?? legacyConfig.leftCard,
      "LOCAL_CURRENCY_BALANCE",
    ),
    right: canonicalCard(
      canonical?.right ?? legacyConfig.rightCard,
      "MONTHLY_REMAINING_BUDGET",
    ),
    ...(selected === undefined ? {} : { selectedLocalCurrencyType: selected }),
    aggregateVersion: number(
      canonical,
      number(household, 0, "homeSummaryConfigVersion"),
      "aggregateVersion",
      "version",
    ),
  };
}

function currencyTypes(
  canonical: readonly firestore.DocumentSnapshot[],
  legacy: readonly firestore.DocumentSnapshot[],
): ReadonlySet<string> {
  const types = new Set<string>();
  for (const snapshot of canonical) {
    const type = text(snapshot.data(), "localCurrencyType", "currencyType");
    if (type !== undefined && type !== "legacy-unknown") types.add(type);
  }
  for (const snapshot of legacy) {
    const type = text(snapshot.data(), "localCurrencyType", "currencyType");
    if (type !== undefined && type !== "legacy-unknown") types.add(type);
  }
  return types;
}

function receiptReference(
  database: firestore.Firestore,
  metadata: HomePreferenceCommandMetadata,
) {
  return database
    .collection("commandReceipts")
    .doc(RECEIPT_CONTEXT)
    .collection("receipts")
    .doc(hash(`${metadata.householdId}\u0000${metadata.idempotencyKey}`));
}

function expiry(occurredAt: string) {
  const parsed = Date.parse(occurredAt);
  return firestoreTtlAfter(
    new Date(Number.isFinite(parsed) ? parsed : Date.now()),
    RETENTION_MILLIS,
  );
}

export class FirebaseHomePreferenceAtomicStore
  implements HomePreferenceAtomicStorePort
{
  constructor(private readonly database: firestore.Firestore) {}

  async transact(
    metadata: HomePreferenceCommandMetadata,
    decide: (
      current: HomePreferenceCommandState,
      availableLocalCurrencyTypes: ReadonlySet<string>,
    ) => HomePreferenceMutation | { readonly kind: "rejected"; readonly code: string },
  ): Promise<
    | HomePreferenceAtomicResult
    | { readonly kind: "rejected"; readonly code: string }
  > {
    const household = this.database.collection("households").doc(metadata.householdId);
    const preference = household.collection("homePreferences").doc("home");
    const canonicalBalances = household.collection("localCurrencyBalances");
    const legacyBalances = this.database.collection("balances");
    const receipt = receiptReference(this.database, metadata);

    try {
      return await this.database.runTransaction(async (transaction) => {
        const [
          receiptSnapshot,
          preferenceSnapshot,
          householdSnapshot,
          canonicalBalanceSnapshot,
          legacyBalanceSnapshot,
        ] = await Promise.all([
          transaction.get(receipt),
          transaction.get(preference),
          transaction.get(household),
          transaction.get(canonicalBalances),
          transaction.get(
            legacyBalances.where("householdId", "==", metadata.householdId),
          ),
        ]);
        if (receiptSnapshot.exists) {
          if (receiptSnapshot.data()?.payloadFingerprint !== metadata.payloadFingerprint) {
            return { kind: "payload-mismatch" } as const;
          }
          return {
            kind: "replayed",
            value: (receiptSnapshot.data()?.result ?? {}) as Readonly<
              Record<string, never>
            >,
          } as const;
        }
        if (!householdSnapshot.exists) {
          return { kind: "rejected", code: "HOUSEHOLD_NOT_FOUND" } as const;
        }

        const current = currentState({
          householdId: metadata.householdId,
          canonical: preferenceSnapshot,
          household: householdSnapshot,
        });
        const availableTypes = currencyTypes(
          canonicalBalanceSnapshot.docs,
          legacyBalanceSnapshot.docs,
        );
        const mutation = decide(current, availableTypes);
        if ("kind" in mutation) return mutation;

        if (mutation.writes) {
          transaction.set(
            preference,
            {
              householdId: metadata.householdId,
              left: mutation.state.left,
              right: mutation.state.right,
              ...(mutation.state.selectedLocalCurrencyType === undefined
                ? { selectedLocalCurrencyType: FieldValue.delete() }
                : {
                    selectedLocalCurrencyType:
                      mutation.state.selectedLocalCurrencyType,
                  }),
              aggregateVersion: mutation.state.aggregateVersion,
              schemaVersion: 2,
              updatedAt: FieldValue.serverTimestamp(),
              ...(!preferenceSnapshot.exists
                ? { createdAt: FieldValue.serverTimestamp() }
                : {}),
            },
            { merge: true },
          );
          transaction.set(
            household,
            {
              homeSummaryConfig: {
                leftCard: CANONICAL_TO_WEB[mutation.state.left],
                rightCard: CANONICAL_TO_WEB[mutation.state.right],
              },
              homeSummaryConfigVersion: mutation.state.aggregateVersion,
              ...(mutation.state.selectedLocalCurrencyType === undefined
                ? { selectedLocalCurrencyType: FieldValue.delete() }
                : {
                    selectedLocalCurrencyType:
                      mutation.state.selectedLocalCurrencyType,
                  }),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          new FirebaseTransactionalOutbox(this.database).append(transaction, {
            eventId: `${hash(
              `${metadata.householdId}\u0000${metadata.idempotencyKey}`,
            )}-home-preference`,
            eventType: "HomeConfigurationChanged.v1",
            householdId: metadata.householdId,
            aggregateId: `home-preferences:${metadata.householdId}`,
            aggregateVersion: mutation.state.aggregateVersion,
            occurredAt: metadata.occurredAt,
            correlationId: metadata.commandId,
            causationId: metadata.commandId,
            payload: {
              changedField: mutation.changedField ?? "summary-cards",
              left: mutation.state.left,
              right: mutation.state.right,
              ...(mutation.state.selectedLocalCurrencyType === undefined
                ? {}
                : {
                    selectedLocalCurrencyType:
                      mutation.state.selectedLocalCurrencyType,
                  }),
            },
          });
        }
        transaction.create(receipt, {
          householdId: metadata.householdId,
          actorMemberId: metadata.actorMemberId,
          commandId: metadata.commandId,
          idempotencyKey: metadata.idempotencyKey,
          command: metadata.commandName,
          payloadFingerprint: metadata.payloadFingerprint,
          result: mutation.value,
          status: "completed",
          terminalAt: metadata.occurredAt,
          completedAt: metadata.occurredAt,
          expiresAt: expiry(metadata.occurredAt),
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { kind: "committed", value: mutation.value } as const;
      });
    } catch (_error) {
      return { kind: "commit-failed" };
    }
  }
}
