import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  ActiveCategorySourceResult,
  CategoryCatalogMutation,
  CategoryCatalogStorePort,
} from "../../../contexts/household-finance/categories-budget/application/ports/out/categoryCatalogStorePort";
import type {
  CategoryArchiveProcess,
  CategoryCatalog,
  CategoryEntity,
} from "../../../contexts/household-finance/categories-budget/domain/model/categoryCatalog";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const RECEIPT_CONTEXT = "household-finance-category-catalog";
const SCHEMA_VERSION = 2;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function receiptExpiry(occurredAt: string) {
  return firestoreTtlAfter(occurredAt);
}

function text(
  data: FirebaseFirestore.DocumentData | undefined,
  ...fields: readonly string[]
): string | undefined {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function integer(
  data: FirebaseFirestore.DocumentData | undefined,
  fallback: number,
  ...fields: readonly string[]
): number {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return fallback;
}

function mapCategory(
  snapshot: firestore.QueryDocumentSnapshot,
): CategoryEntity | undefined {
  const data = snapshot.data();
  const name = text(data, "name", "label");
  const color = text(data, "color");
  if (name === undefined || color === undefined) return undefined;
  const storedState = text(data, "state", "lifecycleState");
  const state =
    storedState === "archive-pending" || storedState === "archived"
      ? storedState
      : data.isActive === false
        ? "archived"
        : "active";
  const budgetCandidate = data.budgetInWon ?? data.budget;
  const budgetInWon =
    budgetCandidate === null ||
    (typeof budgetCandidate === "number" && Number.isSafeInteger(budgetCandidate))
      ? (budgetCandidate as number | null)
      : null;
  return {
    categoryId: text(data, "categoryId", "key") ?? snapshot.id,
    name,
    color,
    budgetInWon,
    state,
    sortOrder: integer(data, 0, "sortOrder", "order"),
    version: Math.max(1, integer(data, 1, "version", "aggregateVersion")),
  };
}

function mapProcess(
  snapshot: firestore.QueryDocumentSnapshot,
): CategoryArchiveProcess | undefined {
  const data = snapshot.data();
  const categoryId = text(data, "categoryId");
  const destinationCategoryId = text(data, "destinationCategoryId");
  const state = text(data, "state");
  return categoryId !== undefined &&
    destinationCategoryId !== undefined &&
    (state === "pending" || state === "completed")
    ? {
        processId: snapshot.id,
        categoryId,
        destinationCategoryId,
        state,
      }
    : undefined;
}

function categorySignature(category: CategoryEntity): string {
  return JSON.stringify([
    category.name,
    category.color,
    category.budgetInWon,
    category.state,
    category.sortOrder,
    category.version,
  ]);
}

interface LoadedCategoryCatalog {
  readonly state: CategoryCatalog;
  readonly canonicalDocumentIds: ReadonlyMap<string, string>;
  readonly legacyDocumentIds: ReadonlyMap<string, string>;
  readonly processIds: ReadonlySet<string>;
  readonly settingsExists: boolean;
}

export interface FirebaseCategoryCatalogStoreInput {
  readonly householdId: string;
  readonly principalUid: string;
  readonly commandId: string;
  readonly payloadFingerprint: string;
  readonly requestedAt: string;
}

export class FirebaseCategoryCatalogStore implements CategoryCatalogStorePort {
  constructor(
    private readonly database: firestore.Firestore,
    private readonly input: FirebaseCategoryCatalogStoreInput,
  ) {}

  private receiptReference(): firestore.DocumentReference {
    return this.database
      .collection("commandReceipts")
      .doc(RECEIPT_CONTEXT)
      .collection("receipts")
      .doc(hash(`${this.input.householdId}\u0000${this.input.commandId}`));
  }

  private async load(
    reader: Pick<firestore.Transaction, "get">,
  ): Promise<LoadedCategoryCatalog> {
    const householdReference = this.database
      .collection("households")
      .doc(this.input.householdId);
    const settingsReference = householdReference
      .collection("categorySettings")
      .doc("default");
    const [household, settings, canonical, legacy, processes] = await Promise.all([
      reader.get(householdReference),
      reader.get(settingsReference),
      reader.get(householdReference.collection("categories")),
      reader.get(
        this.database
          .collection("categories")
          .where("householdId", "==", this.input.householdId),
      ),
      reader.get(householdReference.collection("categoryArchiveProcesses")),
    ]);
    const canonicalMapped = canonical.docs.flatMap((snapshot) => {
      const mapped = mapCategory(snapshot);
      return mapped === undefined ? [] : [mapped];
    });
    const canonicalIds = new Set(canonicalMapped.map(({ categoryId }) => categoryId));
    const legacyMapped = legacy.docs.flatMap((snapshot) => {
      const mapped = mapCategory(snapshot);
      return mapped === undefined || canonicalIds.has(mapped.categoryId) ? [] : [mapped];
    });
    const defaultCategoryId =
      text(settings.data(), "defaultCategoryId") ??
      text(household.data(), "defaultCategoryKey") ??
      [...canonical.docs, ...legacy.docs].flatMap((snapshot) => {
        if (snapshot.data().isDefault !== true) return [];
        const mapped = mapCategory(snapshot);
        return mapped === undefined ? [] : [mapped.categoryId];
      })[0] ??
      null;
    return {
      state: {
        categories: [...canonicalMapped, ...legacyMapped],
        defaultCategoryId,
        catalogVersion: Math.max(
          0,
          integer(settings.data(), 0, "catalogVersion", "aggregateVersion"),
        ),
        archiveProcesses: processes.docs.flatMap((snapshot) => {
          const mapped = mapProcess(snapshot);
          return mapped === undefined ? [] : [mapped];
        }),
      },
      canonicalDocumentIds: new Map(
        canonical.docs.flatMap((snapshot) => {
          const mapped = mapCategory(snapshot);
          return mapped === undefined
            ? []
            : [[mapped.categoryId, snapshot.id] as const];
        }),
      ),
      legacyDocumentIds: new Map(
        legacy.docs.flatMap((snapshot) => {
          const mapped = mapCategory(snapshot);
          return mapped === undefined
            ? []
            : [[mapped.categoryId, snapshot.id] as const];
        }),
      ),
      processIds: new Set(processes.docs.map((snapshot) => snapshot.id)),
      settingsExists: settings.exists,
    };
  }

  async read(): Promise<CategoryCatalog> {
    return this.database.runTransaction(async (transaction) =>
      (await this.load(transaction)).state,
    );
  }

  async readActiveCategories(): Promise<ActiveCategorySourceResult> {
    try {
      const state = await this.read();
      return {
        kind: "success",
        categories: state.categories.filter((category) => category.state === "active"),
      };
    } catch {
      return { kind: "retryable-failure", code: "CATEGORY_REPOSITORY_UNAVAILABLE" };
    }
  }

  async transact<T>(
    operation: (current: CategoryCatalog) => CategoryCatalogMutation<T>,
  ): Promise<T> {
    const receiptReference = this.receiptReference();
    return this.database.runTransaction(async (transaction) => {
      const receipt = await transaction.get(receiptReference);
      if (receipt.exists) {
        if (receipt.data()?.payloadFingerprint !== this.input.payloadFingerprint) {
          throw new Error("Category command payload mismatch");
        }
        return receipt.data()?.result as T;
      }
      const loaded = await this.load(transaction);
      const mutation = operation(loaded.state);
      const beforeById = new Map(
        loaded.state.categories.map((category) => [category.categoryId, category]),
      );
      const changedCategoryIds = mutation.state.categories
        .filter((category) => {
          const before = beforeById.get(category.categoryId);
          return before === undefined || categorySignature(before) !== categorySignature(category);
        })
        .map(({ categoryId }) => categoryId);
      const householdReference = this.database
        .collection("households")
        .doc(this.input.householdId);

      for (const category of mutation.state.categories) {
        if (
          !changedCategoryIds.includes(category.categoryId) &&
          loaded.state.defaultCategoryId === mutation.state.defaultCategoryId
        ) {
          continue;
        }
        const canonicalReference = householdReference
          .collection("categories")
          .doc(
            loaded.canonicalDocumentIds.get(category.categoryId) ??
              category.categoryId,
          );
        const legacyReference = this.database
          .collection("categories")
          .doc(
            loaded.legacyDocumentIds.get(category.categoryId) ??
              category.categoryId,
          );
        const common = {
          householdId: this.input.householdId,
          categoryId: category.categoryId,
          name: category.name,
          color: category.color,
          budgetInWon: category.budgetInWon,
          state: category.state,
          sortOrder: category.sortOrder,
          version: category.version,
          aggregateVersion: category.version,
          schemaVersion: SCHEMA_VERSION,
          updatedAt: FieldValue.serverTimestamp(),
          ...(loaded.canonicalDocumentIds.has(category.categoryId)
            ? {}
            : { createdAt: FieldValue.serverTimestamp() }),
        };
        transaction.set(canonicalReference, common, { merge: true });
        transaction.set(
          legacyReference,
          {
            householdId: this.input.householdId,
            key: category.categoryId,
            label: category.name,
            color: category.color,
            budget: category.budgetInWon,
            order: category.sortOrder,
            isDefault: mutation.state.defaultCategoryId === category.categoryId,
            isActive: category.state === "active",
            state: category.state,
            aggregateVersion: category.version,
            schemaVersion: 1,
            updatedAt: FieldValue.serverTimestamp(),
            ...(loaded.legacyDocumentIds.has(category.categoryId)
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
      }

      transaction.set(
        householdReference.collection("categorySettings").doc("default"),
        {
          defaultCategoryId: mutation.state.defaultCategoryId,
          catalogVersion: mutation.state.catalogVersion,
          aggregateVersion: mutation.state.catalogVersion,
          schemaVersion: SCHEMA_VERSION,
          updatedAt: FieldValue.serverTimestamp(),
          ...(loaded.settingsExists
            ? {}
            : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
      // 현재 Web read model이 household.defaultCategoryKey를 읽는 동안만 유지하는 projection입니다.
      transaction.set(
        householdReference,
        {
          defaultCategoryKey: mutation.state.defaultCategoryId,
          categoryCatalogVersion: mutation.state.catalogVersion,
        },
        { merge: true },
      );

      for (const process of mutation.state.archiveProcesses) {
        const reference = householdReference
          .collection("categoryArchiveProcesses")
          .doc(process.processId);
        transaction.set(
          reference,
          {
            ...process,
            householdId: this.input.householdId,
            schemaVersion: SCHEMA_VERSION,
            updatedAt: FieldValue.serverTimestamp(),
            ...(loaded.processIds.has(process.processId)
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
      }

      const defaultChanged =
        loaded.state.defaultCategoryId !== mutation.state.defaultCategoryId;
      const catalogChanged =
        loaded.state.catalogVersion !== mutation.state.catalogVersion;
      if (catalogChanged || defaultChanged || changedCategoryIds.length > 0) {
        new FirebaseTransactionalOutbox(this.database).append(transaction, {
          eventId: hash(`${this.input.commandId}\u0000category-catalog`),
          eventType: "CategoryCatalogChanged.v1",
          householdId: this.input.householdId,
          aggregateId: this.input.householdId,
          aggregateVersion: mutation.state.catalogVersion,
          occurredAt: this.input.requestedAt,
          correlationId: this.input.commandId,
          causationId: this.input.commandId,
          payload: {
            householdId: this.input.householdId,
            catalogVersion: mutation.state.catalogVersion,
            changedCategoryIds,
            defaultCategoryId: mutation.state.defaultCategoryId,
          },
        });
      }
      transaction.create(receiptReference, {
        householdId: this.input.householdId,
        principalUid: this.input.principalUid,
        commandId: this.input.commandId,
        payloadFingerprint: this.input.payloadFingerprint,
        result: mutation.value,
        status: "completed",
        terminalAt: this.input.requestedAt,
        completedAt: this.input.requestedAt,
        expiresAt: receiptExpiry(this.input.requestedAt),
        schemaVersion: 1,
        createdAt: FieldValue.serverTimestamp(),
      });
      return mutation.value;
    });
  }
}
