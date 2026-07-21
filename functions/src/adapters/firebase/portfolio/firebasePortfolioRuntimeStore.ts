import type * as firestore from "firebase-admin/firestore";

import type {
  PortfolioAtomicResult,
  PortfolioCommandMetadata,
  PortfolioCommandResult,
  PortfolioRefreshLeaseResult,
  PortfolioRuntimeMutation,
  PortfolioRuntimeState,
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
          return {
            kind: "replayed",
            value: receiptSnapshot.data()?.result as PortfolioCommandResult,
          } as const;
        }
        const loaded = await this.loader.load(transaction, metadata.householdId);
        const mutation = decide(loaded.state);
        this.writer.writeMutation(transaction, metadata, loaded, mutation);
        transaction.create(receipt, receiptDocument(metadata, mutation.value));
        return { kind: "committed", value: mutation.value } as const;
      });
    } catch (caught) {
      console.error("Portfolio transaction failed", caught);
      return { kind: "commit-failed" };
    }
  }

  async readState(householdId: string): Promise<PortfolioRuntimeState> {
    return this.database.runTransaction(async (transaction) =>
      (await this.loader.load(transaction, householdId)).state,
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
