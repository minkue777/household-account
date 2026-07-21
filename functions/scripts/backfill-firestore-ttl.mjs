import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import {
  FieldPath,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";

export const TTL_COLLECTION_GROUPS = Object.freeze([
  "shortcutIngressCounters",
  "shortcutHttpReceipts",
  "receipts",
  "recurringCommandReceipts",
  "captureSubmissionReceipts",
  "instrumentCatalogReceipts",
  "notificationEndpoints",
  "notificationInboxes",
  "notificationIntents",
  "notificationDeliveries",
  "shortcutNotificationInboxes",
  "outboxEvents",
  "scheduledJobRuns",
  "scheduledJobResults",
  "scheduledJobMonitorReceipts",
  "scheduledJobIncidents",
]);

const DEFAULT_PAGE_SIZE = 300;
const MAX_BATCH_SIZE = 400;

function usage() {
  return [
    "사용법:",
    "  node scripts/backfill-firestore-ttl.mjs --project PROJECT_ID",
    "  node scripts/backfill-firestore-ttl.mjs --project PROJECT_ID --apply \\",
    "    --confirm-project PROJECT_ID --expected-plan-hash HASH",
    "",
    "기본 실행은 읽기 전용 dry-run입니다. apply는 프로젝트 재확인과 동일 plan hash가 필요합니다.",
    "문서 경로와 ID는 출력하지 않고 collection group별 집계만 출력합니다.",
  ].join("\n");
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 1_000) {
    throw new Error("PAGE_SIZE_INVALID");
  }
  return parsed;
}

function selectedGroups() {
  const requested = option("--group");
  if (requested === undefined) return TTL_COLLECTION_GROUPS;
  const groups = requested
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    groups.length === 0 ||
    groups.some((group) => !TTL_COLLECTION_GROUPS.includes(group))
  ) {
    throw new Error("TTL_COLLECTION_GROUP_INVALID");
  }
  return [...new Set(groups)].sort();
}

function parsedLegacyInstant(value) {
  if (typeof value !== "string") return undefined;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis) : null;
}

async function scanGroup(database, group, pageSize) {
  const convertible = [];
  let invalid = 0;
  let scanned = 0;
  let cursor;
  do {
    let query = database
      .collectionGroup(group)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const page = await query.get();
    for (const document of page.docs) {
      scanned += 1;
      const parsed = parsedLegacyInstant(document.data().expiresAt);
      if (parsed === null) {
        invalid += 1;
      } else if (parsed !== undefined) {
        convertible.push({
          reference: document.ref,
          path: document.ref.path,
          source: document.data().expiresAt,
          value: parsed,
          updateTime: document.updateTime,
        });
      }
    }
    cursor = page.empty ? undefined : page.docs.at(-1);
    if (page.size < pageSize) break;
  } while (cursor !== undefined);
  return { group, scanned, invalid, convertible };
}

function planHash(scans) {
  const canonical = scans
    .flatMap(({ group, convertible }) =>
      convertible.map(({ path, source }) => `${group}\u0000${path}\u0000${source}`),
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

async function applyPlan(database, scans) {
  const operations = scans.flatMap(({ convertible }) => convertible);
  for (let offset = 0; offset < operations.length; offset += MAX_BATCH_SIZE) {
    const batch = database.batch();
    for (const operation of operations.slice(offset, offset + MAX_BATCH_SIZE)) {
      batch.update(
        operation.reference,
        { expiresAt: Timestamp.fromDate(operation.value) },
        { lastUpdateTime: operation.updateTime },
      );
    }
    await batch.commit();
  }
  return operations.length;
}

export async function planLegacyTtlBackfill(database, groups, pageSize) {
  const scans = [];
  for (const group of groups) {
    scans.push(await scanGroup(database, group, pageSize));
  }
  return {
    scans,
    planHash: planHash(scans),
    invalidCount: scans.reduce((sum, scan) => sum + scan.invalid, 0),
    convertibleCount: scans.reduce(
      (sum, scan) => sum + scan.convertible.length,
      0,
    ),
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const projectId = option("--project");
  if (projectId === undefined || projectId.trim() === "") {
    throw new Error("PROJECT_ID_REQUIRED");
  }
  const apply = process.argv.includes("--apply");
  const confirmProject = option("--confirm-project");
  const expectedPlanHash = option("--expected-plan-hash");
  if (
    apply &&
    (confirmProject !== projectId || expectedPlanHash === undefined)
  ) {
    throw new Error("APPLY_CONFIRMATION_REQUIRED");
  }

  const app = initializeApp({
    projectId,
    ...(process.env.FIRESTORE_EMULATOR_HOST
      ? {}
      : { credential: applicationDefault() }),
  });
  const database = getFirestore(app);
  try {
    const groups = selectedGroups();
    const plan = await planLegacyTtlBackfill(
      database,
      groups,
      positiveInteger(option("--page-size"), DEFAULT_PAGE_SIZE),
    );
    const report = {
      mode: apply ? "APPLY" : "DRY_RUN",
      projectId,
      planHash: plan.planHash,
      invalidCount: plan.invalidCount,
      convertibleCount: plan.convertibleCount,
      groups: plan.scans.map(({ group, scanned, invalid, convertible }) => ({
        group,
        scanned,
        invalid,
        convertible: convertible.length,
      })),
    };
    console.log(JSON.stringify(report));

    if (!apply) return;
    if (plan.invalidCount > 0) throw new Error("INVALID_LEGACY_TTL_FOUND");
    if (plan.planHash !== expectedPlanHash) throw new Error("TTL_PLAN_CHANGED");
    const updatedCount = await applyPlan(database, plan.scans);
    console.log(JSON.stringify({ mode: "APPLIED", projectId, updatedCount }));
  } finally {
    await deleteApp(app);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    resolve(process.argv[1]).toLowerCase();

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
