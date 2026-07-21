import type * as firestore from "firebase-admin/firestore";

import {
  runtimeMigrationCandidateDecisionHash,
  runtimeMigrationHash,
  stableMigrationMaterial,
} from "../../../operations/migration/public";
import type {
  RuntimeMigrationCandidate,
  RuntimeMigrationMappingManifest,
  RuntimeMigrationPlanBuilderPort,
  RuntimeMigrationPlanMaterial,
  RuntimeMigrationScope,
} from "../../../operations/migration/public";
import { collectFinanceRuntimeMigration } from "./collectors/financeRuntimeMigrationCollector";
import { collectPaymentConfigurationRuntimeMigration } from "./collectors/paymentConfigurationRuntimeMigrationCollector";
import { collectPortfolioAssetRuntimeMigration } from "./collectors/portfolioAssetRuntimeMigrationCollector";
import { collectPortfolioPositionRuntimeMigration } from "./collectors/portfolioPositionRuntimeMigrationCollector";
import { collectPreferencesRuntimeMigration } from "./collectors/preferencesRuntimeMigrationCollector";
import {
  rawSha256,
  text,
  type RuntimeMigrationCandidateDraft,
} from "./collectors/runtimeMigrationCollectorContract";

function documentMap(snapshot: firestore.QuerySnapshot) {
  return new Map(snapshot.docs.map((document) => [document.id, document.data()]));
}

function summarizeCandidates(candidates: readonly RuntimeMigrationCandidate[]) {
  return {
    count: candidates.length,
    amountInWon: candidates.reduce(
      (sum, candidate) => sum + candidate.amountInWon,
      0,
    ),
    decisionHash: runtimeMigrationHash(
      candidates.map(({ decisionHash }) => decisionHash),
    ),
  };
}

function sourceSummary(drafts: readonly RuntimeMigrationCandidateDraft[]) {
  const sources = new Map<
    string,
    { readonly amountInWon: number; readonly fingerprint: string }
  >();
  for (const draft of drafts) {
    if (!sources.has(draft.sourcePath)) {
      sources.set(draft.sourcePath, {
        amountInWon: draft.sourceAmountInWon,
        fingerprint: draft.sourceFingerprint,
      });
    }
  }
  const ordered = [...sources.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return {
    count: ordered.length,
    amountInWon: ordered.reduce(
      (sum, [, source]) => sum + source.amountInWon,
      0,
    ),
    decisionHash: runtimeMigrationHash(
      ordered.map(([path, source]) => ({
        path,
        fingerprint: source.fingerprint,
      })),
    ),
  };
}

function candidatesFromDrafts(
  drafts: readonly RuntimeMigrationCandidateDraft[],
): readonly RuntimeMigrationCandidate[] {
  return [...drafts]
    .sort((left, right) => left.targetPath.localeCompare(right.targetPath))
    .map((draft, index): RuntimeMigrationCandidate => {
      const decisionHash = runtimeMigrationCandidateDecisionHash({
        sourcePath: draft.sourcePath,
        sourceFingerprint: draft.sourceFingerprint,
        targetPath: draft.targetPath,
        targetData: draft.targetData,
        action: draft.action,
        logicalCollection: draft.logicalCollection,
        amountInWon: draft.amountInWon,
      });
      return {
        index,
        candidateId: runtimeMigrationHash({
          sourcePath: draft.sourcePath,
          targetPath: draft.targetPath,
        }).slice(0, 40),
        sourcePath: draft.sourcePath,
        sourceFingerprint: draft.sourceFingerprint,
        targetPath: draft.targetPath,
        targetData: draft.targetData,
        action: draft.action,
        decisionHash,
        amountInWon: draft.amountInWon,
        logicalCollection: draft.logicalCollection,
      };
    });
}

export class FirebaseRuntimeMigrationPlanBuilder
  implements RuntimeMigrationPlanBuilderPort
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly configuredProjectId: string,
  ) {}

  async build(input: {
    readonly scope: RuntimeMigrationScope;
    readonly mappings: RuntimeMigrationMappingManifest;
    readonly plannedAt: string;
  }): Promise<RuntimeMigrationPlanMaterial> {
    if (input.scope.projectId !== this.configuredProjectId) {
      throw new Error("MIGRATION_PROJECT_SCOPE_MISMATCH");
    }
    if (input.mappings.householdIdHash !== rawSha256(input.scope.householdId)) {
      throw new Error("MIGRATION_MAPPING_HOUSEHOLD_SCOPE_MISMATCH");
    }

    const household = this.database
      .collection("households")
      .doc(input.scope.householdId);
    const [
      householdSnapshot,
      members,
      profiles,
      legacyLedger,
      legacyAssets,
      legacyCategories,
      legacyRecurring,
      legacyStocks,
      legacyCrypto,
      legacyCards,
      legacyMerchantRules,
      legacyBalances,
      canonicalLedger,
      canonicalAssets,
      canonicalCategories,
      categorySettings,
      canonicalRecurring,
      canonicalPlans,
      canonicalRevisions,
      canonicalCards,
      canonicalCardClaims,
      canonicalMerchantRules,
      canonicalMerchantClaims,
      canonicalBalances,
      homePreferences,
    ] = await Promise.all([
      household.get(),
      household.collection("members").get(),
      household.collection("assetOwnerProfiles").get(),
      this.database
        .collection("expenses")
        .where("householdId", "==", input.scope.householdId)
        .get(),
      this.database
        .collection("assets")
        .where("householdId", "==", input.scope.householdId)
        .get(),
      this.database
        .collection("categories")
        .where("householdId", "==", input.scope.householdId)
        .get(),
      this.database
        .collection("recurring_expenses")
        .where("householdId", "==", input.scope.householdId)
        .get(),
      this.database
        .collection("stock_holdings")
        .where("householdId", "==", input.scope.householdId)
        .get(),
      this.database
        .collection("crypto_holdings")
        .where("householdId", "==", input.scope.householdId)
        .get(),
      this.database
        .collection("registered_cards")
        .where("householdId", "==", input.scope.householdId)
        .get(),
      this.database
        .collection("merchant_rules")
        .where("householdId", "==", input.scope.householdId)
        .get(),
      this.database
        .collection("balances")
        .where("householdId", "==", input.scope.householdId)
        .get(),
      household.collection("ledgerTransactions").get(),
      household.collection("assets").get(),
      household.collection("categories").get(),
      household.collection("categorySettings").get(),
      household.collection("recurringPlans").get(),
      household.collection("assetAutomationPlans").get(),
      household.collection("assetAutomationPlanRevisions").get(),
      household.collection("registeredCards").get(),
      household.collection("registeredCardClaims").get(),
      household.collection("merchantRules").get(),
      household.collection("merchantRuleClaims").get(),
      household.collection("localCurrencyBalances").get(),
      household.collection("homePreferences").get(),
    ]);
    if (!householdSnapshot.exists) {
      throw new Error("MIGRATION_HOUSEHOLD_NOT_FOUND");
    }

    const memberIds = new Set(
      members.docs
        .flatMap((snapshot) => [
          snapshot.id,
          text(snapshot.data(), "memberId"),
        ])
        .filter((value) => value !== ""),
    );
    const profileIds = new Set(
      profiles.docs
        .filter((snapshot) => {
          const data = snapshot.data();
          return (
            (data.profileType === "member" ||
              data.profileType === "dependent") &&
            (data.lifecycleState === "active" ||
              data.lifecycleState === "archived")
          );
        })
        .map(({ id }) => id),
    );
    const collectorScope = {
      scope: input.scope,
      mappings: input.mappings,
      plannedAt: input.plannedAt,
      householdPath: household.path,
    };
    const canonicalAssetMap = documentMap(canonicalAssets);

    const results = await Promise.all([
      Promise.resolve(
        collectFinanceRuntimeMigration({
          ...collectorScope,
          memberIds,
          householdSnapshot,
          legacyLedger: legacyLedger.docs,
          legacyCategories: legacyCategories.docs,
          legacyRecurring: legacyRecurring.docs,
          canonicalLedger: documentMap(canonicalLedger),
          canonicalCategories: documentMap(canonicalCategories),
          canonicalRecurring: documentMap(canonicalRecurring),
          hasCategorySettings: !categorySettings.empty,
        }),
      ),
      Promise.resolve(
        collectPortfolioAssetRuntimeMigration({
          ...collectorScope,
          profileIds,
          legacyAssets: legacyAssets.docs,
          canonicalAssets: canonicalAssetMap,
          canonicalPlans: documentMap(canonicalPlans),
          canonicalRevisions: documentMap(canonicalRevisions),
        }),
      ),
      collectPortfolioPositionRuntimeMigration({
        ...collectorScope,
        legacyAssets: legacyAssets.docs,
        legacyStocks: legacyStocks.docs,
        legacyCrypto: legacyCrypto.docs,
        canonicalAssets: canonicalAssetMap,
        loadExistingPosition: async (assetId, positionId) =>
          (
            await household
              .collection("assets")
              .doc(assetId)
              .collection("positions")
              .doc(positionId)
              .get()
          ).data(),
      }),
      Promise.resolve(
        collectPaymentConfigurationRuntimeMigration({
          ...collectorScope,
          memberIds,
          legacyCards: legacyCards.docs,
          legacyMerchantRules: legacyMerchantRules.docs,
          canonicalCards: documentMap(canonicalCards),
          canonicalCardClaims: documentMap(canonicalCardClaims),
          canonicalMerchantRules: documentMap(canonicalMerchantRules),
          canonicalMerchantClaims: documentMap(canonicalMerchantClaims),
        }),
      ),
      Promise.resolve(
        collectPreferencesRuntimeMigration({
          ...collectorScope,
          householdSnapshot,
          legacyBalances: legacyBalances.docs,
          canonicalBalances: documentMap(canonicalBalances),
          homePreference: homePreferences.docs.find(({ id }) => id === "home"),
        }),
      ),
    ]);

    const drafts = results.flatMap((result) => result.drafts);
    const candidates = candidatesFromDrafts(drafts);
    const unresolved = results
      .flatMap((result) => result.unresolved)
      .sort((left, right) =>
        stableMigrationMaterial(left).localeCompare(
          stableMigrationMaterial(right),
        ),
      );
    return {
      scope: input.scope,
      mappingManifestHash: runtimeMigrationHash(input.mappings),
      sourceSummary: sourceSummary(drafts),
      expectedTargetSummary: summarizeCandidates(candidates),
      candidates,
      unresolved,
    };
  }
}
