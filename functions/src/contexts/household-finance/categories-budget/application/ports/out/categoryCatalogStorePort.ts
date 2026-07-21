import {
  CategoryCatalog,
  CategoryEntity,
} from "../../../domain/model/categoryCatalog";

export interface CategoryCatalogMutation<T> {
  state: CategoryCatalog;
  value: T;
}

export type ActiveCategorySourceResult =
  | { kind: "success"; categories: readonly CategoryEntity[] }
  | { kind: "retryable-failure"; code: string };

export interface CategoryCatalogStorePort {
  read(): Promise<CategoryCatalog>;
  readActiveCategories(): Promise<ActiveCategorySourceResult>;
  transact<T>(
    operation: (current: CategoryCatalog) => CategoryCatalogMutation<T>,
  ): Promise<T>;
}

export interface CategoryCatalogIdPort {
  nextCategoryId(commandKey: string): string;
  archiveProcessId(commandKey: string, categoryId: string): string;
}
