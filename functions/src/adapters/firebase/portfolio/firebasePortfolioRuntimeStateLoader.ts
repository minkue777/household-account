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
    const [assetSnapshot, profileSnapshot, planSnapshot] = await Promise.all([
      scope.assetId === undefined
        ? transaction.get(assetCollection)
        : transaction.get(assetCollection.doc(scope.assetId)).then(document => ({ docs: document.exists ? [document] : [] })),
      transaction.get(household.collection("assetOwnerProfiles")),
      scope.automationPlans === false
        ? Promise.resolve({ docs: [] })
        : transaction.get(scope.assetId === undefined
          ? household.collection("assetAutomationPlans")
          : household.collection("assetAutomationPlans").where("assetId", "==", scope.assetId)),
    ]);
    const ownerProfiles = mapOwnerProfiles(householdId, profileSnapshot.docs);
    const assets = assetSnapshot.docs.flatMap(document => {
      const asset = mapAsset({ householdId, assetId: document.id, canonical: document.data(), ownerProfiles });
      return asset === undefined ? [] : [asset];
    });
    const positionSnapshots = await Promise.all(
      (scope.positions === false ? [] : assets).map(asset =>
        transaction.get(assetCollection.doc(asset.assetId).collection("positions")),
      ),
    );
    const positions = positionSnapshots.flatMap((snapshot, index) => snapshot.docs.flatMap(document => {
      const data = document.data();
      const position = mapPosition({
        householdId,
        assetId: assets[index].assetId,
        positionId: document.id,
        sourceKind: text(data, "positionKind") === "crypto" ? "crypto" : "stock",
        canonical: data,
      });
      return position === undefined ? [] : [position];
    }));
    const automationPlans = planSnapshot.docs.flatMap(document => {
      const plan = mapPlan(householdId, document);
      return plan === undefined ? [] : [plan];
    });
    return {
      state: { assets, positions, ownerProfiles, automationPlans },
      canonicalAssetIds: new Set(assetSnapshot.docs.map(({ id }) => id)),
      canonicalPositionIds: new Set(positionSnapshots.flatMap(snapshot => snapshot.docs.map(({ id }) => id))),
      planIds: new Set(planSnapshot.docs.map(({ id }) => id)),
    };
  }
}
