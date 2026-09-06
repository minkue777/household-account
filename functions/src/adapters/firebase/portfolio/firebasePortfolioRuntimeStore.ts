import type * as firestore from "firebase-admin/firestore";

import type {
  PortfolioAtomicResult,
  PortfolioCommandMetadata,
  PortfolioCommandResult,
  PortfolioRefreshLeaseResult,
  PortfolioRuntimeMutation,
  PortfolioRuntimeState,
  PortfolioRuntimeReadScope,
  PortfolioRuntimeStorePort,
} from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import {
  receiptDocument,
  receiptReference,
} from "./firebasePortfolioRuntimeDocuments";
import { FirebasePortfolioRefreshLease } from "./firebasePortfolioRefreshLease";
import { FirebasePortfolioRuntimeMutationWriter } from "./firebasePortfolioRuntimeMutationWriter";
import { FirebasePortfolioRuntimeStateLoader } from "./firebasePortfolioRuntimeStateLoader";

/** Firebase composition root for the portfolio runtime persistence port. */
export class FirebasePortfolioRuntimeStore implements PortfolioRuntimeStorePort {
  private readonly loader: FirebasePortfolioRuntimeStateLoader;
  private readonly writer: FirebasePortfolioRuntimeMutationWriter;
  private readonly refreshLease: FirebasePortfolioRefreshLease;

  constructor(private readonly database: firestore.Firestore) {
    this.loader = new FirebasePortfolioRuntimeStateLoader(database);
    this.writer = new FirebasePortfolioRuntimeMutationWriter(database);
    this.refreshLease = new FirebasePortfolioRefreshLease(database);
  }

  async transact(
    metadata: PortfolioCommandMetadata,
    decide: (state: PortfolioRuntimeState) => PortfolioRuntimeMutation,
    scope?: PortfolioRuntimeReadScope,
  ): Promise<PortfolioAtomicResult> {
    const receipt = receiptReference(this.database, metadata);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const receiptSnapshot = await transaction.get(receipt);
        if (receiptSnapshot.exists) {
          if (
            receiptSnapshot.data()?.payloadFingerprint !==
            metadata.payloadFingerprint
          ) {
            return { kind: "payload-mismatch" } as const;
          }
          if (receiptSnapshot.data()?.status !== "pending") return {
            kind: "replayed",
            value: receiptSnapshot.data()?.result as PortfolioCommandResult,
          } as const;
        }
        const loaded = await this.loader.load(transaction, metadata.householdId, scope);
        const mutation = decide(loaded.state);
        this.writer.writeMutation(transaction, metadata, loaded, mutation);
        const pending = mutation.value.kind === "error" ? mutation.value.retryable === true
          : typeof mutation.value.value.failedCount === "number" && mutation.value.value.failedCount > 0;
        const completedTargetKeys = mutation.value.kind === "success"
          ? mutation.value.value.completedTargetKeys ?? []
          : receiptSnapshot.data()?.completedTargetKeys ?? receiptSnapshot.data()?.result?.value?.completedTargetKeys ?? [];
        transaction.set(receipt, pending
          ? { householdId: metadata.householdId, payloadFingerprint: metadata.payloadFingerprint, result: mutation.value, completedTargetKeys, status: "pending", updatedAt: metadata.occurredAt }
          : receiptDocument(metadata, mutation.value));
        return { kind: "committed", value: mutation.value } as const;
      });
    } catch (caught) {
      console.error("Portfolio transaction failed", caught);
      return { kind: "commit-failed" };
    }
  }

  async readState(householdId: string, scope?: PortfolioRuntimeReadScope): Promise<PortfolioRuntimeState> {
    return this.database.runTransaction(async (transaction) =>
      (await this.loader.load(transaction, householdId, scope)).state,
    );
  }

  acquireRefreshLease(
    metadata: PortfolioCommandMetadata,
    scopeKey: string,
  ): Promise<PortfolioRefreshLeaseResult> {
    return this.refreshLease.acquire(metadata, scopeKey);
  }

  releaseRefreshLease(
    metadata: PortfolioCommandMetadata,
    scopeKey: string,
  ): Promise<void> {
    return this.refreshLease.release(metadata, scopeKey);
  }
}
