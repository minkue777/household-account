import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function usage() {
  return [
    "사용법:",
    "  npm run reconcile:runtime -- --project PROJECT_ID --household HOUSEHOLD_ID",
    "",
    "이 명령은 Firestore를 읽기만 하며 문서를 생성·수정·삭제하지 않습니다.",
  ].join("\n");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

function text(data, ...fields) {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

function number(data, ...fields) {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function lifecycle(data) {
  if (
    data?.deletedAt !== undefined ||
    data?.lifecycleState === "deleted" ||
    data?.lifecycleState === "purging" ||
    data?.state === "archived" ||
    data?.isActive === false
  ) {
    return "deleted";
  }
  return "active";
}

export const normalizers = {
  ledger(id, data) {
    return {
      id,
      lifecycle: lifecycle(data),
      merchant: text(data, "merchant"),
      amountInWon: number(data, "amountInWon", "amount"),
      accountingDate: text(data, "accountingDate", "date"),
      localTime: text(data, "localTime", "time"),
      categoryId: text(data, "categoryId", "category"),
      memo: text(data, "memo"),
      source: text(data, "source") || "legacy-migration",
    };
  },
  asset(id, data) {
    return {
      id,
      lifecycle: lifecycle(data),
      name: text(data, "name"),
      type: text(data, "type"),
      currentBalance: number(data, "currentBalance"),
      currency: text(data, "currency") || "KRW",
      order: number(data, "order"),
    };
  },
  category(id, data) {
    return {
      id,
      lifecycle: lifecycle(data),
      name: text(data, "name", "label"),
      color: text(data, "color"),
      icon: text(data, "icon"),
      order: number(data, "sortOrder", "order"),
      budgetInWon: number(data, "budgetInWon", "budget"),
    };
  },
  recurring(id, data) {
    return {
      id,
      lifecycle: lifecycle(data),
      active: data?.active === false || data?.isActive === false ? false : true,
      merchant: text(data, "merchant"),
      amountInWon: number(data, "amountInWon", "amount"),
      categoryId: text(data, "categoryId", "category"),
      dayOfMonth: number(data, "dayOfMonth"),
      lastProcessedMonth: text(data, "lastProcessedMonth", "lastRegisteredMonth"),
    };
  },
  position(id, data) {
    const lastQuote =
      data?.lastQuote && typeof data.lastQuote === "object"
        ? data.lastQuote
        : {};
    const holdingType = text(data, "holdingType");
    const storedCode = text(data, "instrumentCode", "stockCode", "marketCode")
      .toUpperCase();
    return {
      id,
      lifecycle: lifecycle(data),
      assetId: text(data, "assetId"),
      kind: text(data, "positionKind") ||
        (text(data, "marketCode") ? "crypto" : "stock"),
      // 수동·현금·채권의 synthetic code와 명시 market은 migration 결정 hash로
      // 검증한다. 원문 reconciliation에서는 사용자가 보던 이름과 금액만 비교한다.
      code: ["bond", "cash", "manual"].includes(holdingType)
        ? ""
        : storedCode,
      name: text(data, "instrumentName", "stockName", "coinName"),
      quantity: number(data, "quantity"),
      averagePriceInWon: number(data, "averagePriceInWon", "avgPrice"),
      currentPrice: number(data, "currentPrice") || number(lastQuote, "priceInWon"),
    };
  },
};

function summary(rows) {
  const active = rows.filter(({ lifecycle: state }) => state === "active");
  const ordered = [...active].sort((left, right) => left.id.localeCompare(right.id));
  return {
    storedCount: rows.length,
    activeCount: ordered.length,
    digest: sha256(stable(ordered)),
  };
}

export function comparison(name, legacyRows, canonicalRows) {
  const legacy = summary(legacyRows);
  const canonical = summary(canonicalRows);
  return {
    name,
    status:
      legacy.activeCount === canonical.activeCount &&
      legacy.digest === canonical.digest
        ? "MATCH"
        : "MISMATCH",
    legacy,
    canonical,
  };
}

async function queryLegacy(database, collectionName, householdId, normalize) {
  const snapshot = await database
    .collection(collectionName)
    .where("householdId", "==", householdId)
    .get();
  return snapshot.docs.map((document) => normalize(document.id, document.data()));
}

async function queryCanonical(collection, normalize) {
  const snapshot = await collection.get();
  return snapshot.docs.map((document) => normalize(document.id, document.data()));
}

async function canonicalPositions(household) {
  const assets = await household.collection("assets").get();
  const pages = await Promise.all(
    assets.docs.map(async (asset) => {
      const positions = await asset.ref.collection("positions").get();
      return positions.docs.map((position) =>
        normalizers.position(position.id, {
          ...position.data(),
          assetId: position.data().assetId ?? asset.id,
        }),
      );
    }),
  );
  return pages.flat();
}

export async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const projectId = argument("--project");
  const householdId = argument("--household");
  if (!projectId || !householdId) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  initializeApp({ credential: applicationDefault(), projectId });
  const database = getFirestore();
  const household = database.collection("households").doc(householdId);

  const [
    legacyLedger,
    canonicalLedger,
    legacyAssets,
    canonicalAssets,
    legacyCategories,
    canonicalCategories,
    legacyRecurring,
    canonicalRecurring,
    legacyStocks,
    legacyCrypto,
    positions,
  ] = await Promise.all([
    queryLegacy(database, "expenses", householdId, normalizers.ledger),
    queryCanonical(household.collection("ledgerTransactions"), normalizers.ledger),
    queryLegacy(database, "assets", householdId, normalizers.asset),
    queryCanonical(household.collection("assets"), normalizers.asset),
    queryLegacy(database, "categories", householdId, normalizers.category),
    queryCanonical(household.collection("categories"), normalizers.category),
    queryLegacy(database, "recurring_expenses", householdId, normalizers.recurring),
    queryCanonical(household.collection("recurringPlans"), normalizers.recurring),
    queryLegacy(database, "stock_holdings", householdId, normalizers.position),
    queryLegacy(database, "crypto_holdings", householdId, normalizers.position),
    canonicalPositions(household),
  ]);

  const comparisons = [
    comparison("ledger", legacyLedger, canonicalLedger),
    comparison("assets", legacyAssets, canonicalAssets),
    comparison("categories", legacyCategories, canonicalCategories),
    comparison("recurring", legacyRecurring, canonicalRecurring),
    comparison("positions", [...legacyStocks, ...legacyCrypto], positions),
  ];
  const report = {
    mode: "READ_ONLY_RECONCILIATION",
    comparisonMode: "PRESERVED_BUSINESS_FACTS",
    transformedFieldsVerifiedByPlan: [
      "ledger.creatorMemberId",
      "asset.ownerRef",
      "asset.subType",
    "category.defaultCategoryId",
    "recurring.creatorMemberId",
    "recurring.firstApplicableMonth",
    "position.market",
    "position.syntheticInstrumentCode",
  ],
    projectId,
    householdIdHash: sha256(householdId).slice(0, 20),
    checkedAt: new Date().toISOString(),
    status: comparisons.every(({ status }) => status === "MATCH")
      ? "MATCH"
      : "MISMATCH",
    comparisons,
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "MATCH") process.exitCode = 2;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
