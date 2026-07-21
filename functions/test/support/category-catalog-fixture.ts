import {
  createCategoryCatalogApplication,
  legacyQuickEditDisplay,
} from "../../src/contexts/household-finance/categories-budget/application/categoryCatalogApplication";
import type {
  ActiveCategorySourceResult,
  CategoryCatalogIdPort,
  CategoryCatalogMutation,
  CategoryCatalogStorePort,
} from "../../src/contexts/household-finance/categories-budget/application/ports/out/categoryCatalogStorePort";
import type {
  CategoryReferenceRemapPort,
  CategoryReferenceRemapRequest,
} from "../../src/contexts/household-finance/categories-budget/application/ports/out/categoryReferenceRemapPort";
import type {
  CategoryArchiveProcess,
  CategoryCatalog,
} from "../../src/contexts/household-finance/categories-budget/domain/model/categoryCatalog";
import type {
  CategoryCatalogInputPort,
  CategoryView,
} from "../../src/contexts/household-finance/categories-budget/public";

export interface CategoryCatalogFixtureState {
  categories: readonly CategoryView[];
  defaultCategoryId: string | null;
  catalogVersion: number;
  historicalTransactionCategoryIds: readonly string[];
  recurringCategoryIds: readonly string[];
  merchantRuleCategoryIds: readonly string[];
}

export interface CategoryCatalogFixture {
  state?: Partial<CategoryCatalogFixtureState>;
  failList?: boolean;
  emptyQuickEditList?: boolean;
}

export interface CategoryCatalogFixtureSubject extends CategoryCatalogInputPort {
  publicCommands(): readonly string[];
  state(): CategoryCatalogFixtureState;
}

function cloneCatalog(catalog: CategoryCatalog): CategoryCatalog {
  return {
    categories: catalog.categories.map((category) => ({ ...category })),
    defaultCategoryId: catalog.defaultCategoryId,
    catalogVersion: catalog.catalogVersion,
    archiveProcesses: catalog.archiveProcesses.map((process) => ({ ...process })),
  };
}

class FixtureCategoryCatalogStore implements CategoryCatalogStorePort {
  private catalog: CategoryCatalog;
  private serial: Promise<void> = Promise.resolve();

  constructor(
    fixture: CategoryCatalogFixture,
    private readonly failList: boolean,
  ) {
    this.catalog = {
      categories: (fixture.state?.categories ?? []).map((category) => ({
        ...category,
      })),
      defaultCategoryId: fixture.state?.defaultCategoryId ?? null,
      catalogVersion: fixture.state?.catalogVersion ?? 0,
      archiveProcesses: [] as readonly CategoryArchiveProcess[],
    };
  }

  async read(): Promise<CategoryCatalog> {
    await this.serial;
    return cloneCatalog(this.catalog);
  }

  async readActiveCategories(): Promise<ActiveCategorySourceResult> {
    await this.serial;
    return this.failList
      ? {
          kind: "retryable-failure",
          code: "CATEGORY_REPOSITORY_UNAVAILABLE",
        }
      : { kind: "success", categories: cloneCatalog(this.catalog).categories };
  }

  async transact<T>(
    operation: (current: CategoryCatalog) => CategoryCatalogMutation<T>,
  ): Promise<T> {
    const transaction = this.serial.then(() => {
      const mutation = operation(cloneCatalog(this.catalog));
      this.catalog = cloneCatalog(mutation.state);
      return mutation.value;
    });
    this.serial = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }

  snapshot(): CategoryCatalog {
    return cloneCatalog(this.catalog);
  }
}

class FixtureCategoryIds implements CategoryCatalogIdPort {
  private nextId = 1;

  nextCategoryId(_commandKey: string): string {
    const categoryId = `fixture-category-${this.nextId}`;
    this.nextId += 1;
    return categoryId;
  }

  archiveProcessId(commandKey: string, categoryId: string): string {
    return `archive:${categoryId}:${commandKey}`;
  }
}

class FixtureCategoryReferenceRemapper implements CategoryReferenceRemapPort {
  private recurringIds: string[];
  private merchantIds: string[];

  constructor(fixture: CategoryCatalogFixture) {
    this.recurringIds = [...(fixture.state?.recurringCategoryIds ?? [])];
    this.merchantIds = [...(fixture.state?.merchantRuleCategoryIds ?? [])];
  }

  async remapRecurringReferences(request: CategoryReferenceRemapRequest) {
    this.recurringIds = this.recurringIds.map((categoryId) =>
      categoryId === request.sourceCategoryId
        ? request.destinationCategoryId
        : categoryId,
    );
    return { kind: "success" as const };
  }

  async remapMerchantRuleReferences(request: CategoryReferenceRemapRequest) {
    this.merchantIds = this.merchantIds.map((categoryId) =>
      categoryId === request.sourceCategoryId
        ? request.destinationCategoryId
        : categoryId,
    );
    return { kind: "success" as const };
  }

  recurringCategoryIds(): readonly string[] {
    return [...this.recurringIds];
  }

  merchantRuleCategoryIds(): readonly string[] {
    return [...this.merchantIds];
  }
}

class FixtureCategoryCatalogDriver implements CategoryCatalogFixtureSubject {
  constructor(
    private readonly application: CategoryCatalogInputPort,
    private readonly store: FixtureCategoryCatalogStore,
    private readonly remapper: FixtureCategoryReferenceRemapper,
    private readonly historicalTransactionCategoryIds: readonly string[],
    private readonly emptyQuickEditList: boolean,
  ) {}

  initializeDefaults(commandKey: string) {
    return this.application.initializeDefaults(commandKey);
  }

  createCategory(input: Parameters<CategoryCatalogInputPort["createCategory"]>[0]) {
    return this.application.createCategory(input);
  }

  updateCategory(input: Parameters<CategoryCatalogInputPort["updateCategory"]>[0]) {
    return this.application.updateCategory(input);
  }

  reorder(input: Parameters<CategoryCatalogInputPort["reorder"]>[0]) {
    return this.application.reorder(input);
  }

  archiveCategory(input: Parameters<CategoryCatalogInputPort["archiveCategory"]>[0]) {
    return this.application.archiveCategory(input);
  }

  completeArchive(processId: string) {
    return this.application.completeArchive(processId);
  }

  setDefault(input: Parameters<CategoryCatalogInputPort["setDefault"]>[0]) {
    return this.application.setDefault(input);
  }

  listActive() {
    return this.application.listActive();
  }

  async legacyQuickEditCategories(): Promise<readonly CategoryView[]> {
    return this.emptyQuickEditList
      ? legacyQuickEditDisplay({ kind: "no-data" })
      : this.application.legacyQuickEditCategories();
  }

  defaultForManualEntry() {
    return this.application.defaultForManualEntry();
  }

  publicCommands(): readonly string[] {
    return [
      "InitializeDefaultCategories",
      "CreateCategory",
      "UpdateCategory",
      "ReorderCategories",
      "ArchiveCategory",
      "ContinueCategoryArchiveProcess",
      "SetDefaultCategory",
    ];
  }

  state(): CategoryCatalogFixtureState {
    const catalog = this.store.snapshot();
    return {
      categories: catalog.categories.map((category) => ({ ...category })),
      defaultCategoryId: catalog.defaultCategoryId,
      catalogVersion: catalog.catalogVersion,
      historicalTransactionCategoryIds: [
        ...this.historicalTransactionCategoryIds,
      ],
      recurringCategoryIds: this.remapper.recurringCategoryIds(),
      merchantRuleCategoryIds: this.remapper.merchantRuleCategoryIds(),
    };
  }
}

export function createCategoryCatalogFixtureSubject(
  fixture: CategoryCatalogFixture = {},
): CategoryCatalogFixtureSubject {
  const store = new FixtureCategoryCatalogStore(fixture, fixture.failList ?? false);
  const remapper = new FixtureCategoryReferenceRemapper(fixture);
  const application = createCategoryCatalogApplication({
    store,
    referenceRemapper: remapper,
    ids: new FixtureCategoryIds(),
  });
  return new FixtureCategoryCatalogDriver(
    application,
    store,
    remapper,
    fixture.state?.historicalTransactionCategoryIds ?? [],
    fixture.emptyQuickEditList ?? false,
  );
}
