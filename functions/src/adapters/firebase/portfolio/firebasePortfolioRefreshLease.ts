import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  PortfolioCommandMetadata,
  PortfolioCommandResult,
  PortfolioRefreshLeaseResult,
} from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { receiptReference } from "./firebasePortfolioRuntimeDocuments";
import { hash, text } from "./firebasePortfolioRuntimeValues";

const REFRESH_LEASE_MILLIS = 30_000;

export class FirebasePortfolioRefreshLease {
  constructor(private readonly database: firestore.Firestore) {}

  async acquire(
    metadata: PortfolioCommandMetadata,
    scopeKey: string,
  ): Promise<PortfolioRefreshLeaseResult> {
    const receipt = receiptReference(this.database, metadata);
    const lock = this.database
      .collection("households")
      .doc(metadata.householdId)
      .collection("operationLocks")
      .doc(`market-refresh-${hash(scopeKey)}`);
    const requestedAt = Date.parse(metadata.occurredAt);
    const now = Number.isFinite(requestedAt) ? requestedAt : Date.now();
    try {
      return await this.database.runTransaction(async (transaction) => {
        const [receiptSnapshot, lockSnapshot] = await Promise.all([
          transaction.get(receipt),
          transaction.get(lock),
        ]);
        if (receiptSnapshot.exists) {
          if (
            receiptSnapshot.data()?.payloadFingerprint !==
            metadata.payloadFingerprint
          ) {
            return { kind: "payload-mismatch" } as const;
          }
          return {
            kind: "replayed",
            value: receiptSnapshot.data()?.result as PortfolioCommandResult,
          } as const;
        }
        if (lockSnapshot.exists) {
          const current = lockSnapshot.data();
          const expires = Date.parse(text(current, "leaseExpiresAt"));
          if (
            text(current, "holderCommandId") !== metadata.commandId &&
            Number.isFinite(expires) &&
            expires > now
          ) {
            return { kind: "busy" } as const;
          }
        }
        transaction.set(lock, {
          householdId: metadata.householdId,
          scopeKeyHash: hash(scopeKey),
          holderCommandId: metadata.commandId,
          leaseExpiresAt: new Date(now + REFRESH_LEASE_MILLIS).toISOString(),
          schemaVersion: 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { kind: "acquired" } as const;
      });
    } catch (caught) {
      console.error("Portfolio refresh lease acquisition failed", caught);
      return { kind: "failed" };
    }
  }

  async release(
    metadata: PortfolioCommandMetadata,
    scopeKey: string,
  ): Promise<void> {
    const lock = this.database
      .collection("households")
      .doc(metadata.householdId)
      .collection("operationLocks")
      .doc(`market-refresh-${hash(scopeKey)}`);
    try {
      await this.database.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(lock);
        if (
          snapshot.exists &&
          text(snapshot.data(), "holderCommandId") === metadata.commandId
        ) {
          transaction.delete(lock);
        }
      });
    } catch (caught) {
      console.error("Portfolio refresh lease release failed", caught);
    }
  }
}
