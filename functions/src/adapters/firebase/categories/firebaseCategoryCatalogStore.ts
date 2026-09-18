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
import { invalidateCaptureConfigurationProjection } from "../payment-capture/firebaseCaptureConfigurationProjection";
import { categoryCatalogReference, readCategoryCatalogDocument, type CategoryCatalogDocument } from "./categoryCatalogDocument";

const RECEIPT_CONTEXT = "household-finance-category-catalog";
const SCHEMA_VERSION = 2;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function receiptExpiry(occurredAt: string) {
  return firestoreTtlAfter(occurredAt);
}

function text(data: FirebaseFirestore.DocumentData | undefined, field: string): string | undefined {
  const value = data?.[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
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
  readonly householdActive: boolean;
  readonly state: CategoryCatalog;
  readonly document: CategoryCatalogDocument;
  readonly catalogExists: boolean;
}

export interface FirebaseCategoryCatalogStoreInput {
  readonly requireActiveHousehold?: boolean;
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
    const catalogReference = categoryCatalogReference(this.database, this.input.householdId);
    const [household, catalog, processes] = await Promise.all([
      reader.get(householdReference),
      reader.get(catalogReference),
      reader.get(householdReference.collection("categoryArchiveProcesses")),
    ]);
    const document = readCategoryCatalogDocument(catalog.data(), this.input.householdId);
    return {
      householdActive: household.exists &&
        (household.data()?.lifecycleState ?? "active") === "active" && household.data()?.deletedAt == null,
      state: {
        categories: document.categories,
        defaultCategoryId: document.defaultCategoryId,
        catalogVersion: document.catalogVersion,
        archiveProcesses: processes.docs.flatMap((snapshot) => {
          const mapped = mapProcess(snapshot);
          return mapped === undefined ? [] : [mapped];
        }),
      },
      document,
      catalogExists: catalog.exists,
    };
  }

  async read(): Promise<CategoryCatalog> {
    return this.database.runTransaction(async (transaction) =>
      (await this.load(transaction)).state,
    );
  }

  async readActiveCategories(): Promise<ActiveCategorySourceResult> {
    try {
      const state = readCategoryCatalogDocument(
        (await categoryCatalogReference(this.database, this.input.householdId).get()).data(),
        this.input.householdId,
      );
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
      if (this.input.requireActiveHousehold && !loaded.householdActive) {
        throw new Error("HOUSEHOLD_NOT_ACTIVE");
      }
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
      const catalogChanged = loaded.state.catalogVersion !== mutation.state.catalogVersion
        || loaded.state.defaultCategoryId !== mutation.state.defaultCategoryId
        || loaded.state.categories.length !== mutation.state.categories.length
        || changedCategoryIds.length > 0;
      const householdReference = this.database
        .collection("households")
        .doc(this.input.householdId);

      const catalogDocument = {
        householdId: this.input.householdId,
        categories: mutation.state.categories.map(category => ({ ...category })),
        defaultCategoryId: mutation.state.defaultCategoryId,
        catalogVersion: mutation.state.catalogVersion,
        categoryAliases: loaded.document.categoryAliases,
        schemaVersion: 1,
      };
      readCategoryCatalogDocument(catalogDocument, this.input.householdId);
      // Keep a conservative bound before Firestore's document limit is reached.
      if (Buffer.byteLength(JSON.stringify(catalogDocument), "utf8") > 800_000) {
        throw new Error("CATEGORY_CATALOG_TOO_LARGE");
      }
      // A rejected or already-applied command records its receipt without rewriting the catalog.
      if (catalogChanged) {
        transaction.set(categoryCatalogReference(this.database, this.input.householdId), {
          ...catalogDocument,
          updatedAt: FieldValue.serverTimestamp(),
          ...(loaded.catalogExists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        }, { merge: true });
      }

      const beforeProcesses = new Map(loaded.state.archiveProcesses.map(process => [process.processId, process]));
      for (const process of mutation.state.archiveProcesses) {
        const before = beforeProcesses.get(process.processId);
        if (before?.categoryId === process.categoryId
          && before.destinationCategoryId === process.destinationCategoryId
          && before.state === process.state) continue;
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
            ...(before !== undefined
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
      }

      if (catalogChanged) {
        invalidateCaptureConfigurationProjection(
          transaction,
          this.database,
          this.input.householdId,
        );
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
