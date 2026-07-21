import {
  ActiveCategoryListResult,
  ArchiveCategoryCommand,
  CategoryCatalogInputPort,
  CategoryCatalogView,
  CategoryResult,
  CategoryView,
  CreateCategoryCommand,
  ReorderCategoriesCommand,
  SetDefaultCategoryCommand,
  UpdateCategoryCommand,
} from "./ports/in/categoryCatalogInputPort";
import {
  CategoryCatalogIdPort,
  CategoryCatalogStorePort,
} from "./ports/out/categoryCatalogStorePort";
import { CategoryReferenceRemapPort } from "./ports/out/categoryReferenceRemapPort";
import { CategoryCatalog, CategoryEntity } from "../domain/model/categoryCatalog";
import {
  activeCategories,
  completeCategoryArchive,
  defaultCategories,
  prepareCategoryArchive,
  reorderActiveCategories,
  validateCategoryDetails,
} from "../domain/policies/categoryCatalogPolicy";

export interface CategoryCatalogApplicationDependencies {
  store: CategoryCatalogStorePort;
  referenceRemapper: CategoryReferenceRemapPort;
  ids: CategoryCatalogIdPort;
}

function toView(category: CategoryEntity): CategoryView {
  return {
    categoryId: category.categoryId,
    name: category.name,
    color: category.color,
    budgetInWon: category.budgetInWon,
    state: category.state,
    sortOrder: category.sortOrder,
    version: category.version,
  };
}

function toCatalogView(catalog: CategoryCatalog): CategoryCatalogView {
  return {
    categories: catalog.categories.map(toView),
    defaultCategoryId: catalog.defaultCategoryId,
    catalogVersion: catalog.catalogVersion,
  };
}

export function legacyQuickEditDisplay(
  result: ActiveCategoryListResult,
): readonly CategoryView[] {
  if (result.kind === "success" && result.items.length > 0) {
    return result.items;
  }
  return defaultCategories().map(toView);
}

class DefaultCategoryCatalogApplication implements CategoryCatalogInputPort {
  constructor(private readonly dependencies: CategoryCatalogApplicationDependencies) {}

  async initializeDefaults(
    _commandKey: string,
  ): Promise<CategoryResult<readonly CategoryView[]>> {
    return this.dependencies.store.transact<
      CategoryResult<readonly CategoryView[]>
    >((current) => {
      if (current.categories.length > 0) {
        return {
          state: current,
          value: {
            kind: "already-processed" as const,
            value: current.categories.map(toView),
          },
        };
      }

      const categories = defaultCategories();
      return {
        state: {
          ...current,
          categories,
          defaultCategoryId: "etc",
          catalogVersion: current.catalogVersion + 1,
        },
        value: {
          kind: "success" as const,
          value: categories.map(toView),
        },
      };
    });
  }

  async createCategory(
    input: CreateCategoryCommand,
  ): Promise<CategoryResult<CategoryView>> {
    const details = validateCategoryDetails(input);
    if (details.kind === "invalid") {
      return { kind: "validation-error", code: details.code };
    }

    const categoryId = this.dependencies.ids.nextCategoryId(input.commandKey);
    return this.dependencies.store.transact<CategoryResult<CategoryView>>(
      (current) => {
      if (
        current.categories.some(
          (category) => category.categoryId === categoryId,
        )
      ) {
        return {
          state: current,
          value: {
            kind: "conflict" as const,
            code: "CATEGORY_ID_ALREADY_EXISTS",
          },
        };
      }

      const category: CategoryEntity = {
        categoryId,
        ...details.value,
        state: "active",
        sortOrder:
          current.categories.reduce(
            (maximum, item) => Math.max(maximum, item.sortOrder),
            -1,
          ) + 1,
        version: 1,
      };
      return {
        state: {
          ...current,
          categories: [...current.categories, category],
          catalogVersion: current.catalogVersion + 1,
        },
        value: { kind: "success" as const, value: toView(category) },
      };
      },
    );
  }

  async updateCategory(
    input: UpdateCategoryCommand,
  ): Promise<CategoryResult<CategoryView>> {
    const details = validateCategoryDetails(input);
    if (details.kind === "invalid") {
      return { kind: "validation-error", code: details.code };
    }

    return this.dependencies.store.transact<CategoryResult<CategoryView>>(
      (current) => {
      const target = current.categories.find(
        ({ categoryId }) => categoryId === input.categoryId,
      );
      if (target === undefined) {
        return {
          state: current,
          value: { kind: "conflict" as const, code: "CATEGORY_NOT_FOUND" },
        };
      }
      if (target.version !== input.expectedVersion) {
        return {
          state: current,
          value: {
            kind: "conflict" as const,
            code: "CATEGORY_VERSION_MISMATCH",
          },
        };
      }
      if (target.state !== "active") {
        return {
          state: current,
          value: {
            kind: "conflict" as const,
            code: "CATEGORY_NOT_USABLE",
          },
        };
      }

      const updated: CategoryEntity = {
        ...target,
        ...details.value,
        version: target.version + 1,
      };
      return {
        state: {
          ...current,
          categories: current.categories.map((category) =>
            category.categoryId === updated.categoryId ? updated : category,
          ),
          catalogVersion: current.catalogVersion + 1,
        },
        value: { kind: "success" as const, value: toView(updated) },
      };
      },
    );
  }

  async reorder(
    input: ReorderCategoriesCommand,
  ): Promise<CategoryResult<readonly CategoryView[]>> {
    return this.dependencies.store.transact<
      CategoryResult<readonly CategoryView[]>
    >((current) => {
      const decision = reorderActiveCategories({
        catalog: current,
        expectedCatalogVersion: input.expectedCatalogVersion,
        orderedCategoryIds: input.orderedCategoryIds,
      });
      if (decision.kind !== "success") {
        return { state: current, value: decision };
      }
      return {
        state: decision.catalog,
        value: {
          kind: "success" as const,
          value: activeCategories(decision.catalog.categories).map(toView),
        },
      };
    });
  }

  async archiveCategory(
    input: ArchiveCategoryCommand,
  ): Promise<CategoryResult<never>> {
    const processId = this.dependencies.ids.archiveProcessId(
      input.commandKey,
      input.categoryId,
    );
    return this.dependencies.store.transact<CategoryResult<never>>((current) => {
      const decision = prepareCategoryArchive({
        catalog: current,
        categoryId: input.categoryId,
        expectedVersion: input.expectedVersion,
        processId,
      });
      if (decision.kind === "conflict") {
        return { state: current, value: decision };
      }
      return {
        state: decision.catalog,
        value: { kind: "accepted" as const, processId: decision.process.processId },
      };
    });
  }

  async completeArchive(
    processId: string,
  ): Promise<CategoryResult<CategoryCatalogView>> {
    const before = await this.dependencies.store.read();
    const process = before.archiveProcesses.find(
      (candidate) => candidate.processId === processId,
    );
    if (process === undefined) {
      return { kind: "conflict", code: "ARCHIVE_PROCESS_NOT_FOUND" };
    }
    if (process.state === "pending") {
      const request = {
        processId,
        sourceCategoryId: process.categoryId,
        destinationCategoryId: process.destinationCategoryId,
      };
      const recurring =
        await this.dependencies.referenceRemapper.remapRecurringReferences(
          request,
        );
      if (recurring.kind !== "success") {
        return recurring;
      }
      const merchant =
        await this.dependencies.referenceRemapper.remapMerchantRuleReferences(
          request,
        );
      if (merchant.kind !== "success") {
        return merchant;
      }
    }

    return this.dependencies.store.transact<CategoryResult<CategoryCatalogView>>(
      (current) => {
      const completed = completeCategoryArchive(current, processId);
      if (completed === undefined) {
        return {
          state: current,
          value: {
            kind: "conflict" as const,
            code: "ARCHIVE_PROCESS_STATE_INVALID",
          },
        };
      }
      return {
        state: completed,
        value: { kind: "success" as const, value: toCatalogView(completed) },
      };
      },
    );
  }

  async setDefault(
    input: SetDefaultCategoryCommand,
  ): Promise<CategoryResult<CategoryView>> {
    return this.dependencies.store.transact<CategoryResult<CategoryView>>(
      (current) => {
      const category = current.categories.find(
        ({ categoryId }) => categoryId === input.categoryId,
      );
      if (category === undefined || category.state !== "active") {
        return {
          state: current,
          value: {
            kind: "conflict" as const,
            code: "CATEGORY_NOT_USABLE",
          },
        };
      }
      return {
        state: {
          ...current,
          defaultCategoryId: category.categoryId,
          catalogVersion:
            current.defaultCategoryId === category.categoryId
              ? current.catalogVersion
              : current.catalogVersion + 1,
        },
        value: { kind: "success" as const, value: toView(category) },
      };
      },
    );
  }

  async listActive(): Promise<ActiveCategoryListResult> {
    const source = await this.dependencies.store.readActiveCategories();
    if (source.kind !== "success") {
      return source;
    }
    const items = activeCategories(source.categories).map(toView);
    return items.length === 0 ? { kind: "no-data" } : { kind: "success", items };
  }

  async legacyQuickEditCategories(): Promise<readonly CategoryView[]> {
    return legacyQuickEditDisplay(await this.listActive());
  }

  async defaultForManualEntry(): Promise<
    | { kind: "success"; value: CategoryView }
    | { kind: "contract-failure"; code: "DEFAULT_CATEGORY_REQUIRED" }
  > {
    const catalog = await this.dependencies.store.read();
    const category = catalog.categories.find(
      ({ categoryId }) => categoryId === catalog.defaultCategoryId,
    );
    return category !== undefined && category.state === "active"
      ? { kind: "success", value: toView(category) }
      : { kind: "contract-failure", code: "DEFAULT_CATEGORY_REQUIRED" };
  }
}

export function createCategoryCatalogApplication(
  dependencies: CategoryCatalogApplicationDependencies,
): CategoryCatalogInputPort {
  return new DefaultCategoryCatalogApplication(dependencies);
}
