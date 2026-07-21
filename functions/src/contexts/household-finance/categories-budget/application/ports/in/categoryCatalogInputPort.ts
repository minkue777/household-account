export type CategoryLifecycleState =
  | "active"
  | "archive-pending"
  | "archived";

export interface CategoryView {
  categoryId: string;
  name: string;
  color: string;
  budgetInWon: number | null;
  state: CategoryLifecycleState;
  sortOrder: number;
  version: number;
}

export interface CategoryCatalogView {
  categories: readonly CategoryView[];
  defaultCategoryId: string | null;
  catalogVersion: number;
}

export type CategoryResult<T> =
  | { kind: "success"; value: T }
  | { kind: "already-processed"; value: T }
  | { kind: "accepted"; processId: string }
  | { kind: "validation-error"; code: string }
  | { kind: "conflict"; code: string }
  | { kind: "retryable-failure"; code: string };

export type ActiveCategoryListResult =
  | { kind: "success"; items: readonly CategoryView[] }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

export interface CreateCategoryCommand {
  commandKey: string;
  name: string;
  color: string;
  budgetInWon?: number | null;
}

export interface UpdateCategoryCommand {
  commandKey: string;
  categoryId: string;
  expectedVersion: number;
  name: string;
  color: string;
  budgetInWon: number | null;
}

export interface ReorderCategoriesCommand {
  commandKey: string;
  expectedCatalogVersion: number;
  orderedCategoryIds: readonly string[];
}

export interface ArchiveCategoryCommand {
  commandKey: string;
  categoryId: string;
  expectedVersion: number;
}

export interface SetDefaultCategoryCommand {
  commandKey: string;
  categoryId: string;
}

export interface CategoryCatalogInputPort {
  initializeDefaults(
    commandKey: string,
  ): Promise<CategoryResult<readonly CategoryView[]>>;
  createCategory(
    input: CreateCategoryCommand,
  ): Promise<CategoryResult<CategoryView>>;
  updateCategory(
    input: UpdateCategoryCommand,
  ): Promise<CategoryResult<CategoryView>>;
  reorder(
    input: ReorderCategoriesCommand,
  ): Promise<CategoryResult<readonly CategoryView[]>>;
  archiveCategory(
    input: ArchiveCategoryCommand,
  ): Promise<CategoryResult<never>>;
  completeArchive(
    processId: string,
  ): Promise<CategoryResult<CategoryCatalogView>>;
  setDefault(
    input: SetDefaultCategoryCommand,
  ): Promise<CategoryResult<CategoryView>>;
  listActive(): Promise<ActiveCategoryListResult>;
  legacyQuickEditCategories(): Promise<readonly CategoryView[]>;
  defaultForManualEntry(): Promise<
    | { kind: "success"; value: CategoryView }
    | { kind: "contract-failure"; code: "DEFAULT_CATEGORY_REQUIRED" }
  >;
}
