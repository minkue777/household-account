import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  AdminHouseholdMutation,
  AdminHouseholdStorePort,
} from "../../../contexts/access/admin-household-console/application/ports/out/adminHouseholdStorePort";
import type {
  AdminHousehold,
  AdminHouseholdState,
} from "../../../contexts/access/admin-household-console/domain/model/adminHousehold";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import {
  ACCESS_SCHEMA_VERSION,
  accessEventId,
  accessReceiptReference,
  isoString,
  numberField,
  sha256,
  stringField,
  terminalReceiptFields,
} from "./firebaseAccessPersistence";

export interface FirebaseAdminHouseholdStoreInput {
  readonly principalRef: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly requestedAt: string;
  readonly commandId: string;
}

function mapHousehold(
  snapshot: firestore.QueryDocumentSnapshot,
): AdminHousehold | undefined {
  const data = snapshot.data();
  const name = stringField(data, "name");
  if (name === undefined) return undefined;
  const lifecycle =
    stringField(data, "lifecycleState") ??
    (data.deletedAt === undefined ? "active" : "deleted");
  if (lifecycle !== "active" && lifecycle !== "deleted") return undefined;
  return {
    householdId: snapshot.id,
    name,
    createdAt: isoString(data.createdAt) ?? new Date(0).toISOString(),
    lifecycleState: lifecycle,
    aggregateVersion: numberField(data, "aggregateVersion", 1),
    legacyShareKey: stringField(data, "legacyShareKey") ?? snapshot.id,
  };
}

function changed(left: AdminHousehold, right: AdminHousehold): boolean {
  return (
    left.name !== right.name ||
    left.lifecycleState !== right.lifecycleState ||
    left.aggregateVersion !== right.aggregateVersion ||
    left.legacyShareKey !== right.legacyShareKey
  );
}

export class FirebaseAdminHouseholdStore implements AdminHouseholdStorePort {
  constructor(
    private readonly database: firestore.Firestore,
    private readonly input: FirebaseAdminHouseholdStoreInput,
  ) {}

  private async load(
    transaction?: firestore.Transaction,
  ): Promise<AdminHouseholdState> {
    const query = this.database.collection("households");
    const snapshot =
      transaction === undefined
        ? await query.get()
        : await transaction.get(query);
    return {
      households: snapshot.docs.flatMap((document) => {
        const household = mapHousehold(document);
        return household === undefined ? [] : [household];
      }),
      events: [],
    };
  }

  read(): Promise<AdminHouseholdState> {
    return this.load();
  }

  async transact<T>(
    operation: (current: AdminHouseholdState) => AdminHouseholdMutation<T>,
  ): Promise<T> {
    const receiptReference = accessReceiptReference(
      this.database,
      "access-admin-household",
      this.input.principalRef,
      this.input.idempotencyKey,
    );
    return this.database.runTransaction(async (transaction) => {
      const receipt = await transaction.get(receiptReference);
      if (receipt.exists) {
        if (receipt.data()?.payloadFingerprint !== this.input.payloadFingerprint) {
          throw new Error("Admin household idempotency payload mismatch");
        }
        return receipt.data()?.result as T;
      }

      const current = await this.load(transaction);
      const mutation = operation(current);
      const previousById = new Map(
        current.households.map((household) => [household.householdId, household]),
      );

      for (const household of mutation.state.households) {
        const reference = this.database
          .collection("households")
          .doc(household.householdId);
        const previous = previousById.get(household.householdId);
        if (previous === undefined) {
          transaction.create(reference, {
            householdId: household.householdId,
            name: household.name,
            lifecycleState: household.lifecycleState,
            aggregateVersion: household.aggregateVersion,
            legacyShareKey: household.legacyShareKey ?? household.householdId,
            members: [],
            schemaVersion: ACCESS_SCHEMA_VERSION,
            createdAt: household.createdAt,
            updatedAt: FieldValue.serverTimestamp(),
          });
          continue;
        }
        if (!changed(previous, household)) continue;
        transaction.set(
          reference,
          {
            name: household.name,
            lifecycleState: household.lifecycleState,
            aggregateVersion: household.aggregateVersion,
            legacyShareKey: household.legacyShareKey ?? household.householdId,
            ...(household.lifecycleState === "deleted"
              ? {
                  deletedAt: this.input.requestedAt,
                  deletedByHash: sha256(this.input.principalRef),
                }
              : {
                  deletedAt: FieldValue.delete(),
                  deletedByHash: FieldValue.delete(),
                }),
            schemaVersion: ACCESS_SCHEMA_VERSION,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      for (const event of mutation.state.events) {
        const household = mutation.state.households.find(
          (candidate) => candidate.householdId === event.householdId,
        );
        new FirebaseTransactionalOutbox(this.database).append(transaction, {
          eventId: accessEventId(
            this.input.commandId,
            event.eventType,
            event.householdId,
          ),
          eventType: event.eventType,
          householdId: event.householdId,
          aggregateId: event.householdId,
          aggregateVersion: household?.aggregateVersion ?? 1,
          occurredAt: this.input.requestedAt,
          correlationId: this.input.commandId,
          causationId: this.input.commandId,
          payload: {
            householdId: event.householdId,
            lifecycleState: household?.lifecycleState ?? "active",
          },
        });
      }

      transaction.create(
        receiptReference,
        terminalReceiptFields({
          principalUid: this.input.principalRef,
          payloadFingerprint: this.input.payloadFingerprint,
          result: mutation.value,
          completedAt: this.input.requestedAt,
        }),
      );
      return mutation.value;
    });
  }
}
