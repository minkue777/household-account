import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";

import { FirebaseCategoryCatalogStore } from "../../adapters/firebase/categories/firebaseCategoryCatalogStore";
import { createCategoryCatalogApplication } from "../../contexts/household-finance/categories-budget/application/categoryCatalogApplication";
import type { CategoryResult } from "../../contexts/household-finance/categories-budget/application/ports/in/categoryCatalogInputPort";
import type { CategoryCatalog } from "../../contexts/household-finance/categories-budget/domain/model/categoryCatalog";
import {
  HouseholdCommandRejection,
  type HouseholdCommandExecutionContext,
  type HouseholdCommandHandler,
} from "./householdCommand";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

function stringValue(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string") {
    throw new HouseholdCommandRejection(`${field.toUpperCase()}_REQUIRED`);
  }
  return value;
}

function budgetValue(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new HouseholdCommandRejection("BUDGET_INVALID");
  }
  return value;
}

function actor(context: HouseholdCommandExecutionContext) {
  if (context.actor === undefined) {
    throw new HouseholdCommandRejection("HOUSEHOLD_FORBIDDEN");
  }
  return context.actor;
}

function fingerprint(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

function stableId(prefix: string, commandId: string): string {
  return `${prefix}-${createHash("sha256")
    .update(commandId, "utf8")
    .digest("base64url")
    .slice(0, 22)}`;
}

function resultValue<T>(result: CategoryResult<T>): T | undefined {
  if (result.kind === "success" || result.kind === "already-processed") {
    return result.value;
  }
  if (result.kind === "accepted") return undefined;
  throw new HouseholdCommandRejection(
    result.code,
    result.kind === "retryable-failure",
  );
}

function applicationFor(
  database: firestore.Firestore,
  context: HouseholdCommandExecutionContext,
) {
  const verifiedActor = actor(context);
  const store = new FirebaseCategoryCatalogStore(database, {
    householdId: verifiedActor.householdId,
    principalUid: context.principalUid,
    commandId: context.envelope.commandId,
    payloadFingerprint: fingerprint(context.envelope.payload),
    requestedAt: context.requestedAt,
  });
  return {
    store,
    application: createCategoryCatalogApplication({
      store,
      ids: {
        nextCategoryId: (commandKey) => stableId("category", commandKey),
        archiveProcessId: (commandKey) => stableId("category-archive", commandKey),
      },
      referenceRemapper: {
        async remapRecurringReferences() {
          return { kind: "retryable-failure" as const, code: "ARCHIVE_WORKER_REQUIRED" };
        },
        async remapMerchantRuleReferences() {
          return { kind: "retryable-failure" as const, code: "ARCHIVE_WORKER_REQUIRED" };
        },
      },
    }),
  };
}

async function currentCategory(
  database: firestore.Firestore,
  householdId: string,
  store: FirebaseCategoryCatalogStore,
  categoryIdentifier: string,
) {
  const catalog = await store.read();
  const category = await categoryFromIdentifier(
    database,
    householdId,
    catalog,
    categoryIdentifier,
  );
  if (category === undefined) {
    throw new HouseholdCommandRejection("CATEGORY_NOT_FOUND");
  }
  return { catalog, category };
}

async function categoryFromIdentifier(
  database: firestore.Firestore,
  householdId: string,
  catalog: CategoryCatalog,
  categoryIdentifier: string,
) {
  const direct = catalog.categories.find(
    (item) => item.categoryId === categoryIdentifier,
  );
  if (direct !== undefined) return direct;
  const [canonical, legacy] = await Promise.all([
    database
      .collection("households")
      .doc(householdId)
      .collection("categories")
      .doc(categoryIdentifier)
      .get(),
    database.collection("categories").doc(categoryIdentifier).get(),
  ]);
  const canonicalData = canonical.data();
  const legacyData = legacy.data();
  const stableId =
    typeof canonicalData?.categoryId === "string"
      ? canonicalData.categoryId
      : legacyData?.householdId === householdId && typeof legacyData.key === "string"
        ? legacyData.key
        : undefined;
  return stableId === undefined
    ? undefined
    : catalog.categories.find((item) => item.categoryId === stableId);
}

export function createCategoryHouseholdCommandHandlers(
  database: firestore.Firestore,
): ReadonlyMap<string, HouseholdCommandHandler> {
  return new Map<string, HouseholdCommandHandler>([
    [
      "category.create.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const category = record(payload.category);
          const { application } = applicationFor(database, context);
          const result = resultValue(
            await application.createCategory({
              commandKey: context.envelope.commandId,
              name: stringValue(category, "label"),
              color: stringValue(category, "color"),
              budgetInWon:
                category.budget === undefined ? null : budgetValue(category.budget),
            }),
          );
          return { categoryId: result?.categoryId };
        },
      },
    ],
    [
      "category.update.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const changes = record(payload.changes);
          const { application, store } = applicationFor(database, context);
          const householdId = actor(context).householdId;
          const { category } = await currentCategory(
            database,
            householdId,
            store,
            stringValue(payload, "categoryId"),
          );
          resultValue(
            await application.updateCategory({
              commandKey: context.envelope.commandId,
              categoryId: category.categoryId,
              expectedVersion: category.version,
              name:
                changes.label === undefined
                  ? category.name
                  : stringValue(changes, "label"),
              color:
                changes.color === undefined
                  ? category.color
                  : stringValue(changes, "color"),
              budgetInWon:
                changes.budget === undefined
                  ? category.budgetInWon
                  : budgetValue(changes.budget),
            }),
          );
          return {};
        },
      },
    ],
    [
      "category.archive.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const { application, store } = applicationFor(database, context);
          const householdId = actor(context).householdId;
          const { category } = await currentCategory(
            database,
            householdId,
            store,
            stringValue(payload, "categoryId"),
          );
          resultValue(
            await application.archiveCategory({
              commandKey: context.envelope.commandId,
              categoryId: category.categoryId,
              expectedVersion: category.version,
            }),
          );
          return {};
        },
      },
    ],
    [
      "category.set-budget.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const { application, store } = applicationFor(database, context);
          const householdId = actor(context).householdId;
          const { category } = await currentCategory(
            database,
            householdId,
            store,
            stringValue(payload, "categoryId"),
          );
          resultValue(
            await application.updateCategory({
              commandKey: context.envelope.commandId,
              categoryId: category.categoryId,
              expectedVersion: category.version,
              name: category.name,
              color: category.color,
              budgetInWon: budgetValue(payload.budget),
            }),
          );
          return {};
        },
      },
    ],
    [
      "category.reorder.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          if (!Array.isArray(payload.categories)) {
            throw new HouseholdCommandRejection("CATEGORIES_REQUIRED");
          }
          const ordered = payload.categories
            .map((value) => {
              const item = record(value);
              const order = item.order;
              if (typeof order !== "number" || !Number.isInteger(order)) {
                throw new HouseholdCommandRejection("ORDER_INVALID");
              }
              return {
                categoryId: stringValue(item, "categoryId"),
                order,
              };
            })
            .sort((left, right) => left.order - right.order);
          if (new Set(ordered.map(({ order }) => order)).size !== ordered.length) {
            throw new HouseholdCommandRejection("ORDER_DUPLICATED");
          }
          const { application, store } = applicationFor(database, context);
          const catalog = await store.read();
          const householdId = actor(context).householdId;
          const orderedCategoryIds = await Promise.all(
            ordered.map(async ({ categoryId }) => {
              const category = await categoryFromIdentifier(
                database,
                householdId,
                catalog,
                categoryId,
              );
              if (category === undefined) {
                throw new HouseholdCommandRejection("CATEGORY_NOT_FOUND");
              }
              return category.categoryId;
            }),
          );
          resultValue(
            await application.reorder({
              commandKey: context.envelope.commandId,
              expectedCatalogVersion: catalog.catalogVersion,
              orderedCategoryIds,
            }),
          );
          return {};
        },
      },
    ],
    [
      "category.set-default.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const { application, store } = applicationFor(database, context);
          const { category } = await currentCategory(
            database,
            actor(context).householdId,
            store,
            stringValue(payload, "categoryId"),
          );
          resultValue(
            await application.setDefault({
              commandKey: context.envelope.commandId,
              categoryId: category.categoryId,
            }),
          );
          return {};
        },
      },
    ],
  ]);
}
