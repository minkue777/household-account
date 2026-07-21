export type CategoryState = "active" | "archive-pending" | "archived";

export interface CategoryEntity {
  categoryId: string;
  name: string;
  color: string;
  budgetInWon: number | null;
  state: CategoryState;
  sortOrder: number;
  version: number;
}

export interface CategoryArchiveProcess {
  processId: string;
  categoryId: string;
  destinationCategoryId: string;
  state: "pending" | "completed";
}

export interface CategoryCatalog {
  categories: readonly CategoryEntity[];
  defaultCategoryId: string | null;
  catalogVersion: number;
  archiveProcesses: readonly CategoryArchiveProcess[];
}
