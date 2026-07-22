import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import {
  runtimeMigrationCandidateDecisionHash,
  runtimeMigrationCheckpoint,
  runtimeMigrationHash,
  stableMigrationMaterial,
} from "../../../operations/migration/public";
import type {
  PersistedRuntimeMigrationPlan,
  RuntimeMigrationCandidate,
  RuntimeMigrationPersistencePort,
  RuntimeMigrationPlanMaterial,
  RuntimeMigrationReconciliationSummary,
  RuntimeMigrationScope,
  RuntimeMigrationUnresolved,
} from "../../../operations/migration/public";

const PLAN_COLLECTION = "operationsMigrationPlans";
const PAGE_RECEIPT_COLLECTION = "operationsMigrationPageReceipts";
const ALLOWED_SOURCE_COLLECTIONS = new Set([
  "expenses",
  "assets",
  "categories",
  "recurring_expenses",
  "stock_holdings",
  "crypto_holdings",
  "registered_cards",
  "merchant_rules",
  "balances",
  "households",
]);
const ALLOWED_LOGICAL_COLLECTIONS = new Set([
  "ledger",
  "asset",
  "category",
  "category-setting",
  "recurring",
  "recurring-creator-receipt",
  "position",
  "asset-automation-plan",
  "asset-automation-revision",
  "registered-card",
  "registered-card-claim",
  "merchant-rule",
  "merchant-rule-claim",
  "local-currency-balance",
  "home-preference",
]);

class RuntimeMigrationBlockedError extends Error {
  constructor(
    readonly code: "MIGRATION_SOURCE_CHANGED" | "MIGRATION_TARGET_CONFLICT",
  ) {
    super(code);
  }
}

function planReference(
  database: firestore.Firestore,
  planHash: string,
): firestore.DocumentReference {
  return database.collection(PLAN_COLLECTION).doc(planHash);
}

function text(data: FirebaseFirestore.DocumentData | undefined, field: string) {
  const value = data?.[field];
  return typeof value === "string" ? value : "";
}

function integer(
  data: FirebaseFirestore.DocumentData | undefined,
  field: string,
): number {
  const value = data?.[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function summary(
  data: unknown,
): RuntimeMigrationReconciliationSummary | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  return typeof record.count === "number" &&
    Number.isSafeInteger(record.count) &&
    typeof record.amountInWon === "number" &&
    Number.isSafeInteger(record.amountInWon) &&
    typeof record.decisionHash === "string"
    ? {
        count: record.count,
        amountInWon: record.amountInWon,
        decisionHash: record.decisionHash,
      }
    : undefined;
}

function scope(data: unknown): RuntimeMigrationScope | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }
  const value = data as Record<string, unknown>;
  return typeof value.projectId === "string" &&
    typeof value.householdId === "string" &&
    typeof value.migrationId === "string" &&
    value.migrationKind === "legacy-runtime-to-household-canonical-v1" &&
    value.schemaScope === "legacy-flat-v1:household-canonical-v1" &&
    typeof value.operatorId === "string"
    ? (value as unknown as RuntimeMigrationScope)
    : undefined;
}

function mapPlan(
  snapshot: firestore.DocumentSnapshot,
): PersistedRuntimeMigrationPlan | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const parsedScope = scope(data?.scope);
  const sourceSummary = summary(data?.sourceSummary);
  const expectedTargetSummary = summary(data?.expectedTargetSummary);
  const status = data?.status;
  if (
    parsedScope === undefined ||
    sourceSummary === undefined ||
    expectedTargetSummary === undefined ||
    !["blocked", "planned", "applying", "completed", "failed"].includes(
      String(status),
    )
  ) {
    return undefined;
  }
  return {
    planHash: snapshot.id,
    scope: parsedScope,
    mappingManifestHash: text(data, "mappingManifestHash"),
    sourceSummary,
    expectedTargetSummary,
    candidateCount: integer(data, "candidateCount"),
    unresolvedCount: integer(data, "unresolvedCount"),
    unresolvedDecisionHash: text(data, "unresolvedDecisionHash"),
    status: status as PersistedRuntimeMigrationPlan["status"],
    nextIndex: integer(data, "nextIndex"),
    checkpoint: text(data, "checkpoint"),
    createdAt: text(data, "createdAt"),
    updatedAt: text(data, "updatedAt"),
  };
}

function mapCandidate(
  snapshot: firestore.QueryDocumentSnapshot | firestore.DocumentSnapshot,
): RuntimeMigrationCandidate | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (
    data === undefined ||
    typeof data.index !== "number" ||
    !Number.isSafeInteger(data.index) ||
    typeof data.candidateId !== "string" ||
    typeof data.sourcePath !== "string" ||
    typeof data.sourceFingerprint !== "string" ||
    typeof data.targetPath !== "string" ||
    typeof data.targetData !== "object" ||
    data.targetData === null ||
    Array.isArray(data.targetData) ||
    (data.action !== "create" && data.action !== "merge-missing") ||
    typeof data.decisionHash !== "string" ||
    typeof data.amountInWon !== "number" ||
    !Number.isSafeInteger(data.amountInWon) ||
    typeof data.logicalCollection !== "string" ||
    !ALLOWED_LOGICAL_COLLECTIONS.has(data.logicalCollection) ||
    snapshot.id !== data.candidateId
  ) {
    return undefined;
  }
  return data as RuntimeMigrationCandidate;
}

function matchesExpected(
  actual: FirebaseFirestore.DocumentData | undefined,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  if (actual === undefined) return false;
  return Object.entries(expected).every(
    ([key, value]) =>
      stableMigrationMaterial(actual[key]) === stableMigrationMaterial(value),
  );
}

function isMissingMergeValue(actual: unknown, expected: unknown): boolean {
  return (
    actual === undefined ||
    (typeof actual === "string" &&
      actual.trim() === "" &&
      typeof expected === "string" &&
      expected.trim() !== "")
  );
}

function validateSourcePath(path: string): boolean {
  const segments = path.split("/");
  return segments.length === 2 && ALLOWED_SOURCE_COLLECTIONS.has(segments[0]);
}

function validateTargetPath(path: string, householdId: string): boolean {
  const escaped = householdId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^households/${escaped}/(?:` +
      "ledgerTransactions/[^/]+|" +
      "assets/[^/]+|" +
      "assets/[^/]+/positions/[^/]+|" +
      "categories/[^/]+|" +
      "categorySettings/default|" +
      "recurringPlans/[^/]+|" +
      "recurringCreatorMigrationReceipts/[^/]+|" +
      "assetAutomationPlans/[^/]+|" +
      "assetAutomationPlanRevisions/[^/]+" +
      "|registeredCards/[^/]+" +
      "|registeredCardClaims/[^/]+" +
      "|merchantRules/[^/]+" +
      "|merchantRuleClaims/[^/]+" +
      "|localCurrencyBalances/[^/]+" +
      "|homePreferences/home" +
      ")$",
    "u",
  ).test(path);
}

function sameScope(left: RuntimeMigrationScope, right: RuntimeMigrationScope) {
  return stableMigrationMaterial(left) === stableMigrationMaterial(right);
}

async function commitBatches(
  database: firestore.Firestore,
  writes: readonly ((batch: firestore.WriteBatch) => void)[],
) {
  for (let index = 0; index < writes.length; index += 400) {
    const batch = database.batch();
    for (const write of writes.slice(index, index + 400)) write(batch);
    await batch.commit();
  }
}

export class FirebaseRuntimeMigrationPersistence
  implements RuntimeMigrationPersistencePort
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly configuredProjectId: string,
  ) {}

  async persistDryRun(input: {
    readonly material: RuntimeMigrationPlanMaterial;
    readonly planHash: string;
    readonly plannedAt: string;
  }): Promise<PersistedRuntimeMigrationPlan> {
    if (input.material.scope.projectId !== this.configuredProjectId) {
      throw new Error("MIGRATION_PROJECT_SCOPE_MISMATCH");
    }
    const reference = planReference(this.database, input.planHash);
    const existing = mapPlan(await reference.get());
    if (existing !== undefined) {
      if (
        !sameScope(existing.scope, input.material.scope) ||
        existing.mappingManifestHash !== input.material.mappingManifestHash ||
        existing.candidateCount !== input.material.candidates.length ||
        existing.unresolvedCount !== input.material.unresolved.length ||
        stableMigrationMaterial(existing.sourceSummary) !==
          stableMigrationMaterial(input.material.sourceSummary) ||
        stableMigrationMaterial(existing.expectedTargetSummary) !==
          stableMigrationMaterial(input.material.expectedTargetSummary) ||
        existing.unresolvedDecisionHash !==
          runtimeMigrationHash(input.material.unresolved)
      ) {
        throw new Error("MIGRATION_PLAN_HASH_COLLISION");
      }
      return existing;
    }

    const writes: Array<(batch: firestore.WriteBatch) => void> = [];
    for (const candidate of input.material.candidates) {
      writes.push((batch) =>
        batch.set(reference.collection("candidates").doc(candidate.candidateId), {
          ...candidate,
          planHash: input.planHash,
          schemaVersion: 1,
        }),
      );
    }
    for (const [index, problem] of input.material.unresolved.entries()) {
      const problemId = runtimeMigrationHash({ index, problem }).slice(0, 40);
      writes.push((batch) =>
        batch.set(reference.collection("unresolved").doc(problemId), {
          ...problem,
          index,
          planHash: input.planHash,
          schemaVersion: 1,
        }),
      );
    }
    await commitBatches(this.database, writes);
    const checkpoint = runtimeMigrationCheckpoint(input.planHash, 0);
    const plan: PersistedRuntimeMigrationPlan = {
      planHash: input.planHash,
      scope: input.material.scope,
      mappingManifestHash: input.material.mappingManifestHash,
      sourceSummary: input.material.sourceSummary,
      expectedTargetSummary: input.material.expectedTargetSummary,
      candidateCount: input.material.candidates.length,
      unresolvedCount: input.material.unresolved.length,
      unresolvedDecisionHash: runtimeMigrationHash(input.material.unresolved),
      status: input.material.unresolved.length > 0 ? "blocked" : "planned",
      nextIndex: 0,
      checkpoint,
      createdAt: input.plannedAt,
      updatedAt: input.plannedAt,
    };
    try {
      await reference.create({ ...plan, schemaVersion: 1 });
      return plan;
    } catch {
      const raced = mapPlan(await reference.get());
      if (
        raced !== undefined &&
        sameScope(raced.scope, plan.scope) &&
        raced.mappingManifestHash === plan.mappingManifestHash &&
        stableMigrationMaterial(raced.expectedTargetSummary) ===
          stableMigrationMaterial(plan.expectedTargetSummary)
      ) {
        return raced;
      }
      throw new Error("MIGRATION_PLAN_PERSISTENCE_FAILED");
    }
  }

  async loadPlan(
    planHash: string,
  ): Promise<PersistedRuntimeMigrationPlan | undefined> {
    return mapPlan(await planReference(this.database, planHash).get());
  }

  async loadUnresolved(
    planHash: string,
  ): Promise<readonly RuntimeMigrationUnresolved[]> {
    const snapshot = await planReference(this.database, planHash)
      .collection("unresolved")
      .orderBy("index", "asc")
      .get();
    return snapshot.docs.flatMap((document) => {
      const data = document.data();
      return typeof data.code === "string" &&
        typeof data.sourceCollection === "string" &&
        typeof data.referenceHash === "string"
        ? [
            {
              code: data.code,
              sourceCollection: data.sourceCollection,
              referenceHash: data.referenceHash,
              ...(typeof data.requiredManifestField === "string"
                ? { requiredManifestField: data.requiredManifestField }
                : {}),
              ...(typeof data.detailCode === "string"
                ? { detailCode: data.detailCode }
                : {}),
            } as RuntimeMigrationUnresolved,
          ]
        : [];
    });
  }

  async applyNextPage(input: {
    readonly plan: PersistedRuntimeMigrationPlan;
    readonly pageSize: number;
    readonly appliedAt: string;
  }): Promise<
    | {
        readonly kind: "page-applied" | "page-replayed";
        readonly plan: PersistedRuntimeMigrationPlan;
      }
    | {
        readonly kind: "blocked";
        readonly code: "MIGRATION_SOURCE_CHANGED" | "MIGRATION_TARGET_CONFLICT";
        readonly checkpoint: string;
      }
  > {
    const reference = planReference(this.database, input.plan.planHash);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(reference);
        const current = mapPlan(currentSnapshot);
        if (
          current === undefined ||
          !sameScope(current.scope, input.plan.scope) ||
          current.planHash !== input.plan.planHash
        ) {
          throw new RuntimeMigrationBlockedError("MIGRATION_TARGET_CONFLICT");
        }
        if (current.nextIndex > input.plan.nextIndex) {
          return { kind: "page-replayed" as const, plan: current };
        }
        if (current.nextIndex !== input.plan.nextIndex) {
          throw new RuntimeMigrationBlockedError("MIGRATION_TARGET_CONFLICT");
        }
        const candidateQuery = reference
          .collection("candidates")
          .where("index", ">=", current.nextIndex)
          .orderBy("index", "asc")
          .limit(input.pageSize);
        const candidateSnapshot = await transaction.get(candidateQuery);
        const candidates = candidateSnapshot.docs.flatMap((document) => {
          const candidate = mapCandidate(document);
          return candidate === undefined ? [] : [candidate];
        });
        if (
          candidates.length === 0 ||
          candidates[0].index !== current.nextIndex ||
          candidates.some(
            (candidate, index) => candidate.index !== current.nextIndex + index,
          )
        ) {
          throw new RuntimeMigrationBlockedError("MIGRATION_TARGET_CONFLICT");
        }
        if (
          candidates.some(
            (candidate) =>
              runtimeMigrationCandidateDecisionHash({
                sourcePath: candidate.sourcePath,
                sourceFingerprint: candidate.sourceFingerprint,
                targetPath: candidate.targetPath,
                targetData: candidate.targetData,
                action: candidate.action,
                logicalCollection: candidate.logicalCollection,
                amountInWon: candidate.amountInWon,
              }) !== candidate.decisionHash,
          )
        ) {
          throw new RuntimeMigrationBlockedError("MIGRATION_TARGET_CONFLICT");
        }
        const nextIndex = current.nextIndex + candidates.length;
        const receiptId = runtimeMigrationHash({
          planHash: current.planHash,
          from: current.nextIndex,
          to: nextIndex,
        });
        const receipt = this.database
          .collection(PAGE_RECEIPT_COLLECTION)
          .doc(receiptId);
        const receiptSnapshot = await transaction.get(receipt);
        if (receiptSnapshot.exists) {
          const refreshed = mapPlan(await transaction.get(reference));
          if (refreshed === undefined) {
            throw new RuntimeMigrationBlockedError("MIGRATION_TARGET_CONFLICT");
          }
          return { kind: "page-replayed" as const, plan: refreshed };
        }

        const sourceReferences = candidates.map((candidate) => {
          if (!validateSourcePath(candidate.sourcePath)) {
            throw new RuntimeMigrationBlockedError("MIGRATION_SOURCE_CHANGED");
          }
          return this.database.doc(candidate.sourcePath);
        });
        const targetReferences = candidates.map((candidate) => {
          if (!validateTargetPath(candidate.targetPath, current.scope.householdId)) {
            throw new RuntimeMigrationBlockedError("MIGRATION_TARGET_CONFLICT");
          }
          return this.database.doc(candidate.targetPath);
        });
        const [sources, targets] = await Promise.all([
          transaction.getAll(...sourceReferences),
          transaction.getAll(...targetReferences),
        ]);
        for (const [index, candidate] of candidates.entries()) {
          const source = sources[index];
          const householdSourcePath =
            `households/${current.scope.householdId}`;
          if (
            !source.exists ||
            (source.ref.path !== householdSourcePath &&
              text(source.data(), "householdId") !==
                current.scope.householdId) ||
            runtimeMigrationHash({
              path: source.ref.path,
              data: source.data(),
            }) !== candidate.sourceFingerprint
          ) {
            throw new RuntimeMigrationBlockedError("MIGRATION_SOURCE_CHANGED");
          }
          const target = targets[index];
          if (candidate.action === "create") {
            if (target.exists) {
              if (!matchesExpected(target.data(), candidate.targetData)) {
                throw new RuntimeMigrationBlockedError(
                  "MIGRATION_TARGET_CONFLICT",
                );
              }
            } else {
              transaction.create(target.ref, candidate.targetData);
            }
            continue;
          }
          const actual = target.data();
          if (!target.exists || actual === undefined) {
            throw new RuntimeMigrationBlockedError("MIGRATION_TARGET_CONFLICT");
          }
          for (const [field, expected] of Object.entries(candidate.targetData)) {
            if (
              !isMissingMergeValue(actual[field], expected) &&
              stableMigrationMaterial(actual[field]) !==
                stableMigrationMaterial(expected)
            ) {
              throw new RuntimeMigrationBlockedError(
                "MIGRATION_TARGET_CONFLICT",
              );
            }
          }
          if (!matchesExpected(actual, candidate.targetData)) {
            transaction.set(target.ref, candidate.targetData, { merge: true });
          }
        }
        const checkpoint = runtimeMigrationCheckpoint(current.planHash, nextIndex);
        transaction.create(receipt, {
          receiptId,
          planHash: current.planHash,
          projectId: current.scope.projectId,
          householdId: current.scope.householdId,
          migrationId: current.scope.migrationId,
          fromIndex: current.nextIndex,
          nextIndex,
          candidateDecisionHash: runtimeMigrationHash(
            candidates.map(({ decisionHash }) => decisionHash),
          ),
          status: "completed",
          checkpoint,
          appliedAt: input.appliedAt,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.update(reference, {
          status: "applying",
          nextIndex,
          checkpoint,
          updatedAt: input.appliedAt,
        });
        return {
          kind: "page-applied" as const,
          plan: { ...current, status: "applying", nextIndex, checkpoint, updatedAt: input.appliedAt },
        };
      });
    } catch (error) {
      if (error instanceof RuntimeMigrationBlockedError) {
        return {
          kind: "blocked",
          code: error.code,
          checkpoint: input.plan.checkpoint,
        };
      }
      throw error;
    }
  }

  async reconcile(plan: PersistedRuntimeMigrationPlan): Promise<
    | {
        readonly kind: "match";
        readonly actual: RuntimeMigrationReconciliationSummary;
        readonly plan: PersistedRuntimeMigrationPlan;
      }
    | {
        readonly kind: "mismatch";
        readonly actual: RuntimeMigrationReconciliationSummary;
      }
  > {
    const reference = planReference(this.database, plan.planHash);
    const candidateSnapshot = await reference
      .collection("candidates")
      .orderBy("index", "asc")
      .get();
    const candidates = candidateSnapshot.docs.flatMap((document) => {
      const candidate = mapCandidate(document);
      return candidate === undefined ? [] : [candidate];
    });
    const matched: RuntimeMigrationCandidate[] = [];
    for (let index = 0; index < candidates.length; index += 100) {
      const page = candidates.slice(index, index + 100);
      const targets = await this.database.getAll(
        ...page.map((candidate) => this.database.doc(candidate.targetPath)),
      );
      for (const [targetIndex, target] of targets.entries()) {
        const candidate = page[targetIndex];
        if (matchesExpected(target.data(), candidate.targetData)) {
          matched.push(candidate);
        }
      }
    }
    const actual = {
      count: matched.length,
      amountInWon: matched.reduce(
        (sum, candidate) => sum + candidate.amountInWon,
        0,
      ),
      decisionHash: runtimeMigrationHash(
        matched.map(({ decisionHash }) => decisionHash),
      ),
    };
    const matches =
      stableMigrationMaterial(actual) ===
      stableMigrationMaterial(plan.expectedTargetSummary);
    const updatedAt = new Date().toISOString();
    await this.database.runTransaction(async (transaction) => {
      const latest = mapPlan(await transaction.get(reference));
      if (
        latest === undefined ||
        latest.nextIndex !== latest.candidateCount ||
        latest.planHash !== plan.planHash
      ) {
        throw new Error("MIGRATION_CHECKPOINT_MISMATCH");
      }
      transaction.update(reference, {
        status: matches ? "completed" : "failed",
        actualTargetSummary: actual,
        reconciliationStatus: matches ? "MATCH" : "MISMATCH",
        completedAt: updatedAt,
        updatedAt,
      });
    });
    if (!matches) return { kind: "mismatch", actual };
    return {
      kind: "match",
      actual,
      plan: { ...plan, status: "completed", updatedAt },
    };
  }
}
