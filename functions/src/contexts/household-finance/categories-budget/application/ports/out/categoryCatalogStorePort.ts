import {
  CategoryCatalog,
} from "../../../domain/model/categoryCatalog";

export interface CategoryCatalogMutation<T> {
  state: CategoryCatalog;
  value: T;
}

export interface CategoryCatalogStorePort {
  read(): Promise<CategoryCatalog>;
  transact<T>(
    operation: (current: CategoryCatalog) => CategoryCatalogMutation<T>,
  ): Promise<T>;
}

export interface CategoryCatalogIdPort {
  nextCategoryId(commandKey: string): string;
  archiveProcessId(commandKey: string, categoryId: string): string;
}
