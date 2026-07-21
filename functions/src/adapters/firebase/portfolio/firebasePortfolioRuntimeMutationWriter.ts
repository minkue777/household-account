import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  PortfolioCommandMetadata,
  PortfolioRuntimeMutation,
} from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import {
  canonicalAssetDocument,
  canonicalPositionDocument,
  legacyAssetDocument,
  legacyPositionDocument,
  planDocument,
} from "./firebasePortfolioRuntimeDocuments";
import { hash, stable } from "./firebasePortfolioRuntimeValues";
import type { LoadedState } from "./firebasePortfolioRuntimeStateLoader";

function seoulLocalDate(instant: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return instant.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

export class FirebasePortfolioRuntimeMutationWriter {
  constructor(private readonly database: firestore.Firestore) {}

  writeMutation(
    transaction: firestore.Transaction,
    metadata: PortfolioCommandMetadata,
    before: LoadedState,
    mutation: PortfolioRuntimeMutation,
  ): void {
    if (!mutation.writes) return;
    const household = this.database
      .collection("households")
      .doc(metadata.householdId);
    const beforeAssets = new Map(
      before.state.assets.map((asset) => [asset.assetId, asset]),
    );
    for (const asset of mutation.state.assets) {
      const previous = beforeAssets.get(asset.assetId);
      if (previous !== undefined && stable(previous) === stable(asset)) continue;
      const canonicalCreated = !before.canonicalAssetIds.has(asset.assetId);
      const legacyCreated = !before.legacyAssetIds.has(asset.assetId);
      const canonicalReference = household.collection("assets").doc(asset.assetId);
      const legacyReference = this.database.collection("assets").doc(asset.assetId);
      if (canonicalCreated) {
        transaction.create(
          canonicalReference,
          canonicalAssetDocument(asset, true),
        );
      } else {
        transaction.set(
          canonicalReference,
          canonicalAssetDocument(asset, false),
          { merge: true },
        );
      }
      if (legacyCreated) {
        transaction.create(legacyReference, legacyAssetDocument(asset, true));
      } else {
        transaction.set(legacyReference, legacyAssetDocument(asset, false), {
          merge: true,
        });
      }
    }

    const beforePositions = new Map(
      before.state.positions.map((position) => [position.positionId, position]),
    );
    for (const position of mutation.state.positions) {
      const previous = beforePositions.get(position.positionId);
      if (previous !== undefined && stable(previous) === stable(position)) continue;
      const canonicalReference = household
        .collection("assets")
        .doc(position.assetId)
        .collection("positions")
        .doc(position.positionId);
      const canonicalCreated = !before.canonicalPositionIds.has(position.positionId);
      if (canonicalCreated) {
        transaction.create(
          canonicalReference,
          canonicalPositionDocument(position, true),
        );
      } else {
        transaction.set(
          canonicalReference,
          canonicalPositionDocument(position, false),
          { merge: true },
        );
      }
      if (
        previous === undefined ||
        previous.quantity !== position.quantity ||
        previous.lifecycleState !== position.lifecycleState
      ) {
        const snapshotId = hash(
          `${metadata.commandId}\u0000${position.positionId}\u0000quantity`,
        );
        transaction.create(
          household
            .collection("assets")
            .doc(position.assetId)
            .collection("positionHistory")
            .doc(snapshotId),
          {
            snapshotId,
            householdId: metadata.householdId,
            assetId: position.assetId,
            positionId: position.positionId,
            instrument: {
              market: position.market,
              ...(position.exchange === undefined
                ? {}
                : { exchange: position.exchange }),
              instrumentType: position.instrumentType.toLocaleUpperCase("en-US"),
              code: position.instrumentCode,
              currency: position.currency,
            },
            snapshotDate: seoulLocalDate(metadata.occurredAt),
            quantity:
              position.lifecycleState === "deleted" ? 0 : position.quantity,
            observedAt: metadata.occurredAt,
            sourceVersion: position.aggregateVersion,
            operation:
              previous === undefined
                ? "added"
                : position.lifecycleState === "deleted"
                  ? "deleted"
                  : "quantity-changed",
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
          },
        );
      }
      const stockReference = this.database
        .collection("stock_holdings")
        .doc(position.positionId);
      const cryptoReference = this.database
        .collection("crypto_holdings")
        .doc(position.positionId);
      if (position.lifecycleState === "deleted") {
        if (before.legacyStockPositionIds.has(position.positionId)) {
          transaction.delete(stockReference);
        }
        if (before.legacyCryptoPositionIds.has(position.positionId)) {
          transaction.delete(cryptoReference);
        }
        continue;
      }
      const legacyReference =
        position.positionKind === "stock" ? stockReference : cryptoReference;
      const legacyCreated =
        position.positionKind === "stock"
          ? !before.legacyStockPositionIds.has(position.positionId)
          : !before.legacyCryptoPositionIds.has(position.positionId);
      if (legacyCreated) {
        transaction.create(
          legacyReference,
          legacyPositionDocument(position, true),
        );
      } else {
        transaction.set(
          legacyReference,
          legacyPositionDocument(position, false),
          { merge: true },
        );
      }
    }

    const beforePlans = new Map(
      before.state.automationPlans.map((plan) => [plan.planId, plan]),
    );
    for (const plan of mutation.state.automationPlans) {
      const previous = beforePlans.get(plan.planId);
      if (previous !== undefined && stable(previous) === stable(plan)) continue;
      const reference = household
        .collection("assetAutomationPlans")
        .doc(plan.planId);
      if (!before.planIds.has(plan.planId)) {
        transaction.create(reference, planDocument(plan, true));
      } else {
        transaction.set(reference, planDocument(plan, false), { merge: true });
      }
      if (
        previous === undefined ||
        previous.currentRevision !== plan.currentRevision
      ) {
        transaction.create(
          household
            .collection("assetAutomationPlanRevisions")
            .doc(`${plan.planId}_${plan.currentRevision}`),
          {
            revisionId: `${plan.planId}_${plan.currentRevision}`,
            planId: plan.planId,
            householdId: plan.householdId,
            assetId: plan.assetId,
            operation: plan.operation,
            revision: plan.currentRevision,
            effectiveFrom: plan.updatedAt,
            amountInWon: plan.amountInWon,
            configuredDay: plan.configuredDay,
            ...(plan.repaymentMethod === undefined
              ? {}
              : { repaymentMethod: plan.repaymentMethod }),
            ...(plan.annualInterestRate === undefined
              ? {}
              : { annualInterestRate: plan.annualInterestRate }),
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
          },
        );
      }
    }

    const outbox = new FirebaseTransactionalOutbox(this.database);
    for (const event of mutation.events) {
      outbox.append(transaction, {
        eventId: hash(
          `${metadata.commandId}\u0000${event.eventType}\u0000${event.aggregateId}`,
        ),
        eventType: event.eventType,
        householdId: metadata.householdId,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        occurredAt: metadata.occurredAt,
        correlationId: metadata.commandId,
        causationId: metadata.commandId,
        payload: event.payload,
      });
    }
  }
}
