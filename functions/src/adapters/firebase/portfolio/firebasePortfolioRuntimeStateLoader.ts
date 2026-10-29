import type * as firestore from "firebase-admin/firestore";

import type {
  PortfolioRuntimeState,
  PortfolioRuntimeReadScope,
} from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { mapAsset, mapOwnerProfiles, mapPlan, mapPosition } from "./firebasePortfolioRuntimeMappers";
import { text } from "./firebasePortfolioRuntimeValues";

export interface LoadedState {
  readonly state: PortfolioRuntimeState;
  readonly canonicalAssetIds: ReadonlySet<string>;
  readonly canonicalPositionIds: ReadonlySet<string>;
  readonly planIds: ReadonlySet<string>;
}

export class FirebasePortfolioRuntimeStateLoader {
  constructor(private readonly database: firestore.Firestore) {}

  async load(
    transaction: firestore.Transaction,
    householdId: string,
    scope: PortfolioRuntimeReadScope = {},
  ): Promise<LoadedState> {
    const household = this.database.collection("households").doc(householdId);
    const assetCollection = household.collection("assets");
    const [assetSnapshot, profileSnapshot, planSnapshot, positionSnapshot] = await Promise.all([
      scope.assetId === undefined
        ? transaction.get(assetCollection)
        : transaction.get(assetCollection.doc(scope.assetId)).then(document => ({ docs: document.exists ? [document] : [] })),
      transaction.get(household.collection("assetOwnerProfiles")),
      scope.automationPlans === false
        ? Promise.resolve({ docs: [] })
        : transaction.get(scope.assetId === undefined
          ? household.collection("assetAutomationPlans")
          : household.collection("assetAutomationPlans").where("assetId", "==", scope.assetId)),
      scope.positions === false
        ? Promise.resolve({ docs: [] })
        : transaction.get(scope.assetId === undefined
          ? this.database.collectionGroup("positions").where("householdId", "==", householdId)
          : assetCollection.doc(scope.assetId).collection("positions")),
    ]);
    const ownerProfiles = mapOwnerProfiles(householdId, profileSnapshot.docs);
    const assets = assetSnapshot.docs.flatMap(document => {
      const asset = mapAsset({ householdId, assetId: document.id, canonical: document.data(), ownerProfiles });
      return asset === undefined ? [] : [asset];
    });
    const assetIds = new Set(assets.map(asset => asset.assetId));
    // A group query's householdId field is not proof of its canonical parent.
    const positionDocuments = positionSnapshot.docs.filter(document => {
      const parent = document.ref.parent.parent;
      return parent !== null && assetIds.has(parent.id) &&
        parent.path === `${assetCollection.path}/${parent.id}`;
    });
    const positions = positionDocuments.flatMap(document => {
      const data = document.data();
      const position = mapPosition({
        householdId,
        assetId: document.ref.parent.parent!.id,
        positionId: document.id,
        sourceKind: text(data, "positionKind") === "crypto" ? "crypto" : "stock",
        canonical: data,
      });
      return position === undefined ? [] : [position];
    });
    const automationPlans = planSnapshot.docs.flatMap(document => {
      const plan = mapPlan(householdId, document);
      return plan === undefined ? [] : [plan];
    });
    return {
      state: { assets, positions, ownerProfiles, automationPlans },
      canonicalAssetIds: new Set(assetSnapshot.docs.map(({ id }) => id)),
      canonicalPositionIds: new Set(positionDocuments.map(({ id }) => id)),
      planIds: new Set(planSnapshot.docs.map(({ id }) => id)),
    };
  }
}
