type StoredDocument = Record<string, unknown>;

interface QueryFilter {
  readonly field: string;
  readonly value: unknown;
}

class MemoryDocumentSnapshot {
  constructor(
    readonly reference: MemoryDocumentReference,
    private readonly stored: StoredDocument | undefined,
  ) {}

  get exists(): boolean {
    return this.stored !== undefined;
  }

  get id(): string {
    return this.reference.id;
  }

  data(): StoredDocument | undefined {
    return this.stored === undefined ? undefined : structuredClone(this.stored);
  }
}

class MemoryQuerySnapshot {
  constructor(readonly docs: readonly MemoryDocumentSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0;
  }

  get size(): number {
    return this.docs.length;
  }
}

class MemoryQuery {
  readonly kind = "query";

  constructor(
    readonly collectionPath: string,
    readonly filters: readonly QueryFilter[],
  ) {}

  where(field: string, operator: string, value: unknown): MemoryQuery {
    if (operator !== "==") throw new Error(`Unsupported operator: ${operator}`);
    return new MemoryQuery(this.collectionPath, [
      ...this.filters,
      { field, value },
    ]);
  }
}

class MemoryCollectionReference extends MemoryQuery {
  readonly collectionKind = "collection";

  constructor(
    readonly path: string,
    private readonly database?: InMemoryFirestore,
  ) {
    super(path, []);
  }

  doc(id: string): MemoryDocumentReference {
    return new MemoryDocumentReference(`${this.path}/${id}`, this.database);
  }
}

class MemoryDocumentReference {
  readonly kind = "document";

  constructor(
    readonly path: string,
    private readonly database?: InMemoryFirestore,
  ) {}

  get id(): string {
    return this.path.split("/").at(-1) ?? "";
  }

  collection(name: string): MemoryCollectionReference {
    return new MemoryCollectionReference(`${this.path}/${name}`, this.database);
  }

  async get(): Promise<MemoryDocumentSnapshot> {
    if (this.database === undefined) {
      throw new Error("MEMORY_DOCUMENT_DATABASE_NOT_BOUND");
    }
    return new MemoryDocumentSnapshot(this, this.database.document(this.path));
  }
}

type StagedWrite =
  | {
      readonly kind: "set";
      readonly path: string;
      readonly value: StoredDocument;
      readonly merge: boolean;
      readonly requireAbsent: boolean;
    }
  | { readonly kind: "delete"; readonly path: string };

class MemoryTransaction {
  private readonly writes: StagedWrite[] = [];

  constructor(private readonly database: InMemoryFirestore) {}

  async get(
    target: MemoryDocumentReference | MemoryCollectionReference | MemoryQuery,
  ): Promise<MemoryDocumentSnapshot | MemoryQuerySnapshot> {
    if (target instanceof MemoryDocumentReference) {
      return new MemoryDocumentSnapshot(
        target,
        this.database.document(target.path),
      );
    }
    const docs = this.database
      .documentsInCollection(target.collectionPath)
      .filter(({ value: document }) =>
        target.filters.every(
          ({ field, value: expected }) =>
            expected === valueAt(document, field),
        ),
      )
      .map(
        ({ path, value }) =>
          new MemoryDocumentSnapshot(new MemoryDocumentReference(path), value),
      );
    return new MemoryQuerySnapshot(docs);
  }

  set(
    reference: MemoryDocumentReference,
    value: StoredDocument,
    options?: { readonly merge?: boolean },
  ): this {
    this.writes.push({
      kind: "set",
      path: reference.path,
      value: structuredClone(value),
      merge: options?.merge === true,
      requireAbsent: false,
    });
    return this;
  }

  create(reference: MemoryDocumentReference, value: StoredDocument): this {
    this.writes.push({
      kind: "set",
      path: reference.path,
      value: structuredClone(value),
      merge: false,
      requireAbsent: true,
    });
    return this;
  }

  update(reference: MemoryDocumentReference, value: StoredDocument): this {
    if (!this.database.has(reference.path)) throw new Error("NOT_FOUND");
    return this.set(reference, value, { merge: true });
  }

  delete(reference: MemoryDocumentReference): this {
    this.writes.push({ kind: "delete", path: reference.path });
    return this;
  }

  commit(): void {
    for (const write of this.writes) {
      if (write.kind === "delete") continue;
      if (write.requireAbsent && this.database.has(write.path)) {
        throw new Error(`ALREADY_EXISTS:${write.path}`);
      }
    }
    for (const write of this.writes) {
      if (write.kind === "delete") {
        this.database.remove(write.path);
      } else {
        this.database.write(write.path, write.value, write.merge);
      }
    }
  }
}

function valueAt(value: StoredDocument, field: string): unknown {
  return field.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, value);
}

export class InMemoryFirestore {
  private readonly documents = new Map<string, StoredDocument>();

  collection(path: string): MemoryCollectionReference {
    return new MemoryCollectionReference(path, this);
  }

  async runTransaction<T>(
    operation: (transaction: MemoryTransaction) => Promise<T>,
  ): Promise<T> {
    const transaction = new MemoryTransaction(this);
    const value = await operation(transaction);
    transaction.commit();
    return value;
  }

  seed(path: string, value: StoredDocument): void {
    this.documents.set(path, structuredClone(value));
  }

  document(path: string): StoredDocument | undefined {
    const value = this.documents.get(path);
    return value === undefined ? undefined : structuredClone(value);
  }

  has(path: string): boolean {
    return this.documents.has(path);
  }

  remove(path: string): void {
    this.documents.delete(path);
  }

  write(path: string, value: StoredDocument, merge: boolean): void {
    const current = this.documents.get(path);
    this.documents.set(
      path,
      merge && current !== undefined
        ? { ...structuredClone(current), ...structuredClone(value) }
        : structuredClone(value),
    );
  }

  documentsInCollection(
    collectionPath: string,
  ): readonly { readonly path: string; readonly value: StoredDocument }[] {
    const prefix = `${collectionPath}/`;
    return [...this.documents.entries()]
      .filter(([path]) => {
        if (!path.startsWith(prefix)) return false;
        return !path.slice(prefix.length).includes("/");
      })
      .map(([path, value]) => ({ path, value: structuredClone(value) }));
  }

  paths(prefix = ""): readonly string[] {
    return [...this.documents.keys()]
      .filter((path) => path.startsWith(prefix))
      .sort();
  }
}
