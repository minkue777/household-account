import type * as firestore from "firebase-admin/firestore";

import type {
  PortfolioRuntimeState,
  PortfolioRuntimeReadScope,
} from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import {
  mapAsset,
  mapOwnerProfiles,
  mapPlan,
  mapPosition,
} from "./firebasePortfolioRuntimeMappers";
import { text } from "./firebasePortfolioRuntimeValues";

export interface LoadedState {
  readonly state: PortfolioRuntimeState;
  readonly canonicalAssetIds: ReadonlySet<string>;
  readonly legacyAssetIds: ReadonlySet<string>;
  readonly canonicalPositionIds: ReadonlySet<string>;
  readonly legacyStockPositionIds: ReadonlySet<string>;
  readonly legacyCryptoPositionIds: ReadonlySet<string>;
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
    const canonicalAssets = household.collection("assets");
    const assetSnapshots = scope.assetId === undefined
      ? Promise.all([
          transaction.get(canonicalAssets),
          transaction.get(this.database.collection("assets").where("householdId", "==", householdId)),
        ])
      : transaction.getAll(canonicalAssets.doc(scope.assetId), this.database.collection("assets").doc(scope.assetId)).then(([canonical, legacy]) => [
          { docs: canonical.exists ? [canonical] : [] },
          { docs: legacy.exists && legacy.data()?.householdId === householdId ? [legacy] : [] },
        ] as const);
    const assetState = Promise.all([
        assetSnapshots,
        transaction.get(household.collection("assetOwnerProfiles")),
        scope.automationPlans === false ? Promise.resolve({ docs: [] }) : transaction.get(scope.assetId === undefined ? household.collection("assetAutomationPlans") : household.collection("assetAutomationPlans").where("assetId", "==", scope.assetId)),
      ]).then(async ([[canonicalAssetSnapshot, legacyAssetSnapshot], profileSnapshot, planSnapshot]) => {
        const ownerProfiles = mapOwnerProfiles(householdId, profileSnapshot.docs);
        const canonicalById = new Map(
          canonicalAssetSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]),
        );
        const legacyById = new Map(
          legacyAssetSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]),
        );
        const assetIds = new Set([...legacyById.keys(), ...canonicalById.keys()]);
        const assets = [...assetIds].flatMap((assetId) => {
          const asset = mapAsset({
            householdId,
            assetId,
            canonical: canonicalById.get(assetId),
            legacy: legacyById.get(assetId),
            ownerProfiles,
          });
          return asset === undefined ? [] : [asset];
        });
        const canonicalPositionSnapshots = await Promise.all(
          (scope.positions === false ? [] : assets).map(asset =>
            transaction.get(canonicalAssets.doc(asset.assetId).collection("positions")),
          ),
        );
        return { canonicalAssetSnapshot, legacyAssetSnapshot, planSnapshot, ownerProfiles, assets, canonicalPositionSnapshots };
      });
    // Legacy positions need only the requested scope. Their queries run while
    // the asset/profile -> canonical positions branch resolves independently.
    const [loadedAssets, legacyStockSnapshot, legacyCryptoSnapshot] = await Promise.all([
        assetState,
        scope.positions === false ? Promise.resolve({ docs: [] }) : transaction.get(scope.assetId === undefined ? this.database.collection("stock_holdings").where("householdId", "==", householdId) : this.database.collection("stock_holdings").where("householdId", "==", householdId).where("assetId", "==", scope.assetId)),
        scope.positions === false ? Promise.resolve({ docs: [] }) : transaction.get(scope.assetId === undefined ? this.database.collection("crypto_holdings").where("householdId", "==", householdId) : this.database.collection("crypto_holdings").where("householdId", "==", householdId).where("assetId", "==", scope.assetId)),
      ]);
    const { canonicalAssetSnapshot, legacyAssetSnapshot, planSnapshot, ownerProfiles, assets, canonicalPositionSnapshots } = loadedAssets;
    const legacyStockById = new Map(
      legacyStockSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]),
    );
    const legacyCryptoById = new Map(
      legacyCryptoSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]),
    );
    const canonicalPositions = new Map<
      string,
      { readonly assetId: string; readonly data: FirebaseFirestore.DocumentData }
    >();
    canonicalPositionSnapshots.forEach((snapshot, index) => {
      const assetId = assets[index].assetId;
      for (const position of snapshot.docs) {
        canonicalPositions.set(position.id, { assetId, data: position.data() });
      }
    });
    const positionIds = new Set([
      ...legacyStockById.keys(),
      ...legacyCryptoById.keys(),
      ...canonicalPositions.keys(),
    ]);
    const positions = [...positionIds].flatMap((positionId) => {
      const canonical = canonicalPositions.get(positionId);
      const legacyStock = legacyStockById.get(positionId);
      const legacyCrypto = legacyCryptoById.get(positionId);
      const sourceKind =
        text(canonical?.data, "positionKind") === "crypto" ||
        (canonical === undefined && legacyCrypto !== undefined)
          ? "crypto"
          : "stock";
      const legacy = sourceKind === "crypto" ? legacyCrypto : legacyStock;
      const assetId =
        canonical?.assetId ?? text(legacy, "assetId");
      if (assetId === "") return [];
      const position = mapPosition({
        householdId,
        assetId,
        positionId,
        sourceKind,
        canonical: canonical?.data,
        legacy,
      });
      return position === undefined ? [] : [position];
    });
    const automationPlans = planSnapshot.docs.flatMap((snapshot) => {
      const plan = mapPlan(householdId, snapshot);
      return plan === undefined ? [] : [plan];
    });
    return {
      state: { assets, positions, ownerProfiles, automationPlans },
      canonicalAssetIds: new Set(canonicalAssetSnapshot.docs.map(({ id }) => id)),
      legacyAssetIds: new Set(legacyAssetSnapshot.docs.map(({ id }) => id)),
      canonicalPositionIds: new Set(canonicalPositions.keys()),
      legacyStockPositionIds: new Set(
        legacyStockSnapshot.docs.map(({ id }) => id),
      ),
      legacyCryptoPositionIds: new Set(
        legacyCryptoSnapshot.docs.map(({ id }) => id),
      ),
      planIds: new Set(planSnapshot.docs.map(({ id }) => id)),
    };
  }
}
