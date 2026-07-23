import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  HouseholdLifecycleMutation,
  HouseholdLifecycleUnitOfWorkPort,
} from "../../../contexts/access/household-lifecycle/application/ports/out/householdLifecyclePorts";
import type {
  HouseholdLifecycleReceipt,
  HouseholdLifecycleState,
} from "../../../contexts/access/household-lifecycle/domain/model/householdLifecycle";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import {
  ACCESS_SCHEMA_VERSION,
  accessEventId,
  accessReceiptReference,
  isoString,
  numberField,
  terminalReceiptFields,
} from "./firebaseAccessPersistence";

export interface FirebaseHouseholdLifecycleUnitOfWorkInput {
  readonly householdId: string;
  readonly principalUid: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly commandId: string;
}

interface LoadedLifecycleState {
  readonly state: HouseholdLifecycleState;
  readonly receiptReference: firestore.DocumentReference;
  readonly membershipClaims: firestore.QuerySnapshot;
}

export class FirebaseHouseholdLifecycleUnitOfWork
  implements HouseholdLifecycleUnitOfWorkPort
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly input: FirebaseHouseholdLifecycleUnitOfWorkInput,
  ) {}

  private async load(
    transaction: firestore.Transaction,
  ): Promise<LoadedLifecycleState> {
    const householdReference = this.database
      .collection("households")
      .doc(this.input.householdId);
    const receiptReference = accessReceiptReference(
      this.database,
      "access-household-lifecycle",
      this.input.principalUid,
      this.input.idempotencyKey,
    );
    const membershipClaimsQuery = this.database
      .collection("principalMembershipClaims")
      .where("householdId", "==", this.input.householdId);
    const [householdSnapshot, receiptSnapshot, membershipClaims] = await Promise.all([
      transaction.get(householdReference),
      transaction.get(receiptReference),
      transaction.get(membershipClaimsQuery),
    ]);
    if (!householdSnapshot.exists) throw new Error("Household not found");
    const household = householdSnapshot.data();
    const lifecycle = household?.lifecycleState;
    const lifecycleState =
      lifecycle === "active" ||
      lifecycle === "deleted" ||
      lifecycle === "purging" ||
      lifecycle === "purged"
        ? lifecycle
        : household?.deletedAt === undefined
          ? "active"
          : "deleted";
    const deletedAt = isoString(household?.deletedAt);
    const deletedByHash =
      typeof household?.deletedByHash === "string"
        ? household.deletedByHash
        : undefined;
    const storedReceipt = receiptSnapshot.data()?.receipt;
    return {
      state: {
        household: {
          householdId: this.input.householdId,
          lifecycleState,
          aggregateVersion: numberField(household, "aggregateVersion", 1),
          ...(deletedAt === undefined ? {} : { deletedAt }),
          ...(deletedByHash === undefined ? {} : { deletedByHash }),
        },
        receipts:
          typeof storedReceipt === "object" && storedReceipt !== null
            ? [storedReceipt as HouseholdLifecycleReceipt]
            : [],
        events: [],
      },
      receiptReference,
      membershipClaims,
    };
  }

  async read(): Promise<HouseholdLifecycleState> {
    return this.database.runTransaction(async (transaction) =>
      (await this.load(transaction)).state,
    );
  }

  async transact<T>(
    operation: (state: HouseholdLifecycleState) => HouseholdLifecycleMutation<T>,
  ): Promise<T> {
    return this.database.runTransaction(async (transaction) => {
      const loaded = await this.load(transaction);
      const mutation = operation(loaded.state);
      const householdReference = this.database
        .collection("households")
        .doc(this.input.householdId);
      const household = mutation.state.household;
      if (JSON.stringify(household) !== JSON.stringify(loaded.state.household)) {
        transaction.update(householdReference, {
          lifecycleState: household.lifecycleState,
          aggregateVersion: household.aggregateVersion,
          ...(household.deletedAt === undefined
            ? { deletedAt: FieldValue.delete(), deletedByHash: FieldValue.delete() }
            : {
                deletedAt: household.deletedAt,
                deletedByHash: household.deletedByHash,
              }),
          schemaVersion: ACCESS_SCHEMA_VERSION,
          updatedAt: FieldValue.serverTimestamp(),
        });
        for (const claim of loaded.membershipClaims.docs) {
          transaction.update(claim.ref, {
            householdLifecycleState:
              household.lifecycleState === "active" ? "active" : "deleted",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      const receipt = mutation.state.receipts.find(
        (candidate) => candidate.idempotencyKey === this.input.idempotencyKey,
      );
      if (receipt !== undefined) {
        transaction.set(
          loaded.receiptReference,
          {
            ...terminalReceiptFields({
              principalUid: this.input.principalUid,
              householdId: this.input.householdId,
              payloadFingerprint: receipt.payloadFingerprint,
              result: receipt.result,
              completedAt: this.input.requestedAt,
            }),
            receipt,
          },
          { merge: true },
        );
      }

      for (const event of mutation.state.events) {
        if (
          event.eventType !== "HouseholdDeleted.v1" &&
          event.eventType !== "HouseholdRestored.v1"
        ) {
          continue;
        }
        const occurredAt =
          event.eventType === "HouseholdDeleted.v1"
            ? event.deletedAt
            : event.restoredAt;
        new FirebaseTransactionalOutbox(this.database).append(transaction, {
          eventId: accessEventId(
            this.input.commandId,
            event.eventType,
            event.householdId,
          ),
          eventType: event.eventType,
          householdId: event.householdId,
          aggregateId: event.householdId,
          aggregateVersion: household.aggregateVersion,
          occurredAt,
          correlationId: this.input.commandId,
          causationId: this.input.commandId,
          payload:
            event.eventType === "HouseholdDeleted.v1"
              ? {
                  householdId: event.householdId,
                  deletedAt: event.deletedAt,
                  deletedByHash: event.deletedByHash,
                }
              : {
                  householdId: event.householdId,
                  restoredAt: event.restoredAt,
                  restoredByHash: event.restoredByHash,
                },
        });
      }
      return mutation.value;
    });
  }
}
