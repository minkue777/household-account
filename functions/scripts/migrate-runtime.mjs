import { readFile } from "node:fs/promises";

import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function usage() {
  return [
    "운영 전용 legacy → canonical migration CLI",
    "",
    "dry-run:",
    "  npm run migrate:runtime -- --mode dry-run --project PROJECT --household HOUSEHOLD --migration-id ID --migration-kind legacy-runtime-to-household-canonical-v1 --schema-scope legacy-flat-v1:household-canonical-v1 --operator OPERATOR --mapping FILE",
    "",
    "apply:",
    "  npm run migrate:runtime -- --mode apply --project PROJECT --household HOUSEHOLD --migration-id ID --migration-kind legacy-runtime-to-household-canonical-v1 --schema-scope legacy-flat-v1:household-canonical-v1 --operator OPERATOR --plan-hash HASH --confirm APPLY [--checkpoint HASH:INDEX]",
    "",
    "일반 Web/Android/Functions API에는 이 명령의 실행 경로가 없습니다.",
  ].join("\n");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function positiveIntegerArgument(name, fallback) {
  const raw = argument(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("CLI_ARGUMENT_INVALID");
  return parsed;
}

function required(name) {
  const value = argument(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("CLI_ARGUMENT_REQUIRED");
  }
  return value.trim();
}

function safeOutput(result) {
  if (result.kind === "dry-run") {
    return {
      kind: result.kind,
      planHash: result.planHash,
      scopeHash: result.scopeHash,
      candidateCount: result.candidateCount,
      unresolvedCount: result.unresolved.length,
      unresolved: result.unresolved,
      sourceSummary: result.sourceSummary,
      expectedTargetSummary: result.expectedTargetSummary,
      checkpoint: result.checkpoint,
    };
  }
  if (result.kind === "applied" || result.kind === "checkpoint") return result;
  return {
    kind: result.kind,
    code: result.code,
    ...(result.planHash === undefined ? {} : { planHash: result.planHash }),
    ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
    ...(result.unresolved === undefined
      ? {}
      : {
          unresolvedCount: result.unresolved.length,
          unresolved: result.unresolved,
        }),
  };
}

function optionalRecord(value, predicate) {
  return value === undefined || (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(predicate)
  );
}

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim() !== "";
const isPositiveInteger = (value) =>
  Number.isSafeInteger(value) && value > 0;
const isPositionMarket = (value) =>
  value === "KRX" ||
  value === "US" ||
  value === "KOFIA_FUND" ||
  value === "UNRESOLVED";
const isLocalCurrencyType = (value) =>
  value === "gyeonggi" || value === "daejeon" || value === "sejong";

function validManifest(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    value.version === 1 &&
    typeof value.householdIdHash === "string" &&
    /^[a-f0-9]{64}$/u.test(value.householdIdHash) &&
    optionalRecord(value.memberReferences, isNonEmptyString) &&
    (value.missingCreatorMemberId === undefined ||
      isNonEmptyString(value.missingCreatorMemberId)) &&
    optionalRecord(value.ledgerCreators, isNonEmptyString) &&
    optionalRecord(value.ledgerNotificationRequesters, isNonEmptyString) &&
    optionalRecord(value.recurringCreators, isNonEmptyString) &&
    optionalRecord(value.registeredCardOwners, isNonEmptyString) &&
    optionalRecord(value.merchantRulePriorities, isPositiveInteger) &&
    optionalRecord(value.assetOwners, isNonEmptyString) &&
    optionalRecord(value.positionAssets, isNonEmptyString) &&
    optionalRecord(value.positionMarkets, isPositionMarket) &&
    optionalRecord(
      value.assetAutomationFirstApplicableMonths,
      (entry) => typeof entry === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(entry),
    ) &&
    optionalRecord(value.localCurrencyTypes, isLocalCurrencyType) &&
    optionalRecord(value.localCurrencyPreferredDocuments, isNonEmptyString) &&
    (value.homeSelectedLocalCurrencyType === undefined ||
      isLocalCurrencyType(value.homeSelectedLocalCurrencyType)) &&
    (value.defaultCategoryId === undefined ||
      isNonEmptyString(value.defaultCategoryId))
  );
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const mode = required("--mode");
  if (mode !== "dry-run" && mode !== "apply") throw new Error("CLI_MODE_INVALID");
  const projectId = required("--project");
  const householdId = required("--household");
  const migrationId = required("--migration-id");
  const migrationKind = required("--migration-kind");
  const schemaScope = required("--schema-scope");
  const operatorId = required("--operator");
  if (
    migrationKind !== "legacy-runtime-to-household-canonical-v1" ||
    schemaScope !== "legacy-flat-v1:household-canonical-v1"
  ) {
    throw new Error("CLI_SCOPE_UNSUPPORTED");
  }
  const app = initializeApp(
    process.env.FIRESTORE_EMULATOR_HOST
      ? { projectId }
      : { credential: applicationDefault(), projectId },
    `runtime-migration-${Date.now()}`,
  );
  const database = getFirestore(app);
  const [{ FirebaseRuntimeMigrationPlanBuilder }, { FirebaseRuntimeMigrationPersistence }, { createRuntimeMigrationApplication }] =
    await Promise.all([
      import("../lib/adapters/firebase/migration/firebaseRuntimeMigrationPlanBuilder.js"),
      import("../lib/adapters/firebase/migration/firebaseRuntimeMigrationPersistence.js"),
      import("../lib/operations/migration/public.js"),
    ]);
  const application = createRuntimeMigrationApplication({
    builder: new FirebaseRuntimeMigrationPlanBuilder(database, projectId),
    persistence: new FirebaseRuntimeMigrationPersistence(database, projectId),
  });
  const scope = {
    projectId,
    householdId,
    migrationId,
    migrationKind,
    schemaScope,
    operatorId,
  };
  const now = argument("--at") ?? new Date().toISOString();
  let result;
  if (mode === "dry-run") {
    const raw = JSON.parse(await readFile(required("--mapping"), "utf8"));
    if (!validManifest(raw)) throw new Error("MAPPING_MANIFEST_INVALID");
    result = await application.dryRun({ scope, mappings: raw, plannedAt: now });
  } else {
    result = await application.apply({
      scope,
      expectedPlanHash: required("--plan-hash"),
      confirmation: argument("--confirm") === "APPLY" ? "APPLY" : "MISSING",
      ...(argument("--checkpoint") === undefined
        ? {}
        : { checkpoint: argument("--checkpoint") }),
      pageSize: positiveIntegerArgument("--page-size", 50),
      maxPages: positiveIntegerArgument("--max-pages", 10_000),
      appliedAt: now,
    });
  }
  process.stdout.write(`${JSON.stringify(safeOutput(result), null, 2)}\n`);
  if (result.kind === "blocked") process.exitCode = 2;
  await deleteApp(app);
}

try {
  await main();
} catch (error) {
  const knownCodes = new Set([
    "CLI_ARGUMENT_INVALID",
    "CLI_ARGUMENT_REQUIRED",
    "CLI_MODE_INVALID",
    "CLI_SCOPE_UNSUPPORTED",
    "MAPPING_MANIFEST_INVALID",
    "MIGRATION_PROJECT_SCOPE_MISMATCH",
    "MIGRATION_MAPPING_HOUSEHOLD_SCOPE_MISMATCH",
    "MIGRATION_HOUSEHOLD_NOT_FOUND",
    "MIGRATION_PLAN_HASH_COLLISION",
    "MIGRATION_PLAN_PERSISTENCE_FAILED",
    "MIGRATION_CHECKPOINT_MISMATCH",
  ]);
  const code = error instanceof Error && knownCodes.has(error.message)
    ? error.message
    : "MIGRATION_INTERNAL_FAILURE";
  process.stderr.write(`${JSON.stringify({ kind: "failed", code })}\n`);
  if (code.startsWith("CLI_")) process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
}
