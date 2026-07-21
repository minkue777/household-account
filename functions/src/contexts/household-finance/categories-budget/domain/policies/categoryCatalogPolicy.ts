import {
  CategoryArchiveProcess,
  CategoryCatalog,
  CategoryEntity,
} from "../model/categoryCatalog";

interface DefaultCategoryDefinition {
  categoryId: string;
  name: string;
  color: string;
}

const DEFAULT_CATEGORY_DEFINITIONS: readonly DefaultCategoryDefinition[] = [
  { categoryId: "living", name: "생활비", color: "#4ADE80" },
  { categoryId: "childcare", name: "육아비", color: "#F472B6" },
  { categoryId: "fixed", name: "고정비", color: "#60A5FA" },
  { categoryId: "food", name: "식비", color: "#FBBF24" },
  { categoryId: "etc", name: "기타", color: "#9CA3AF" },
];

export interface ValidCategoryDetails {
  name: string;
  color: string;
  budgetInWon: number | null;
}

export type CategoryDetailsValidation =
  | { kind: "valid"; value: ValidCategoryDetails }
  | { kind: "invalid"; code: string };

export function validateCategoryDetails(input: {
  name: string;
  color: string;
  budgetInWon?: number | null;
}): CategoryDetailsValidation {
  const name = input.name.trim();
  if (name.length === 0) {
    return { kind: "invalid", code: "CATEGORY_NAME_REQUIRED" };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) {
    return { kind: "invalid", code: "INVALID_COLOR" };
  }

  const budgetInWon = input.budgetInWon ?? null;
  if (
    budgetInWon !== null &&
    (!Number.isSafeInteger(budgetInWon) || budgetInWon < 0)
  ) {
    return { kind: "invalid", code: "INVALID_CATEGORY_BUDGET" };
  }

  return {
    kind: "valid",
    value: { name, color: input.color, budgetInWon },
  };
}

export function defaultCategories(): readonly CategoryEntity[] {
  return DEFAULT_CATEGORY_DEFINITIONS.map((definition, sortOrder) => ({
    ...definition,
    budgetInWon: null,
    state: "active" as const,
    sortOrder,
    version: 1,
  }));
}

export function activeCategories(
  categories: readonly CategoryEntity[],
): readonly CategoryEntity[] {
  return categories
    .filter((category) => category.state === "active")
    .slice()
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.categoryId.localeCompare(right.categoryId),
    );
}

export type ReorderDecision =
  | { kind: "success"; catalog: CategoryCatalog }
  | { kind: "validation-error"; code: "ORDER_IDS_MISMATCH" }
  | { kind: "conflict"; code: "CATALOG_VERSION_MISMATCH" };

export function reorderActiveCategories(input: {
  catalog: CategoryCatalog;
  expectedCatalogVersion: number;
  orderedCategoryIds: readonly string[];
}): ReorderDecision {
  if (input.catalog.catalogVersion !== input.expectedCatalogVersion) {
    return { kind: "conflict", code: "CATALOG_VERSION_MISMATCH" };
  }

  const activeIds = activeCategories(input.catalog.categories).map(
    ({ categoryId }) => categoryId,
  );
  const proposedIds = new Set(input.orderedCategoryIds);
  if (
    proposedIds.size !== input.orderedCategoryIds.length ||
    proposedIds.size !== activeIds.length ||
    activeIds.some((categoryId) => !proposedIds.has(categoryId))
  ) {
    return { kind: "validation-error", code: "ORDER_IDS_MISMATCH" };
  }

  const orderById = new Map(
    input.orderedCategoryIds.map((categoryId, sortOrder) => [
      categoryId,
      sortOrder,
    ]),
  );
  const categories = input.catalog.categories.map((category) => {
    const sortOrder = orderById.get(category.categoryId);
    if (sortOrder === undefined || sortOrder === category.sortOrder) {
      return category;
    }
    return { ...category, sortOrder, version: category.version + 1 };
  });

  return {
    kind: "success",
    catalog: {
      ...input.catalog,
      categories,
      catalogVersion: input.catalog.catalogVersion + 1,
    },
  };
}

export type ArchivePreparationDecision =
  | {
      kind: "accepted";
      catalog: CategoryCatalog;
      process: CategoryArchiveProcess;
    }
  | { kind: "conflict"; code: string };

export function prepareCategoryArchive(input: {
  catalog: CategoryCatalog;
  categoryId: string;
  expectedVersion: number;
  processId: string;
}): ArchivePreparationDecision {
  const target = input.catalog.categories.find(
    ({ categoryId }) => categoryId === input.categoryId,
  );
  if (target === undefined) {
    return { kind: "conflict", code: "CATEGORY_NOT_FOUND" };
  }
  if (target.version !== input.expectedVersion) {
    return { kind: "conflict", code: "CATEGORY_VERSION_MISMATCH" };
  }
  if (input.catalog.defaultCategoryId === target.categoryId) {
    return { kind: "conflict", code: "CATEGORY_IS_DEFAULT" };
  }
  if (target.state !== "active") {
    return { kind: "conflict", code: "CATEGORY_NOT_USABLE" };
  }

  const destination = input.catalog.categories.find(
    ({ categoryId }) => categoryId === input.catalog.defaultCategoryId,
  );
  if (destination === undefined || destination.state !== "active") {
    return { kind: "conflict", code: "DEFAULT_CATEGORY_REQUIRED" };
  }

  const process: CategoryArchiveProcess = {
    processId: input.processId,
    categoryId: target.categoryId,
    destinationCategoryId: destination.categoryId,
    state: "pending",
  };
  return {
    kind: "accepted",
    process,
    catalog: {
      ...input.catalog,
      categories: input.catalog.categories.map((category) =>
        category.categoryId === target.categoryId
          ? {
              ...category,
              state: "archive-pending" as const,
              version: category.version + 1,
            }
          : category,
      ),
      catalogVersion: input.catalog.catalogVersion + 1,
      archiveProcesses: [...input.catalog.archiveProcesses, process],
    },
  };
}

export function completeCategoryArchive(
  catalog: CategoryCatalog,
  processId: string,
): CategoryCatalog | undefined {
  const process = catalog.archiveProcesses.find(
    (candidate) => candidate.processId === processId,
  );
  if (process === undefined) {
    return undefined;
  }
  if (process.state === "completed") {
    return catalog;
  }

  const target = catalog.categories.find(
    ({ categoryId }) => categoryId === process.categoryId,
  );
  if (target === undefined || target.state !== "archive-pending") {
    return undefined;
  }

  return {
    ...catalog,
    categories: catalog.categories.map((category) =>
      category.categoryId === target.categoryId
        ? {
            ...category,
            state: "archived" as const,
            version: category.version + 1,
          }
        : category,
    ),
    catalogVersion: catalog.catalogVersion + 1,
    archiveProcesses: catalog.archiveProcesses.map((candidate) =>
      candidate.processId === processId
        ? { ...candidate, state: "completed" as const }
        : candidate,
    ),
  };
}
