type StoredDocument = Record<string, unknown>;

function firestoreWriteValue(value: unknown): unknown {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(firestoreWriteValue);
  if (typeof value !== "object" || value === null) return value;
  if (value.constructor.name === "DeleteTransform") return { __memoryFieldValue: "delete" };
  if (value.constructor.name === "ServerTimestampTransform") return new Date();
  if ("toDate" in value && typeof value.toDate === "function") return value.toDate();
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, firestoreWriteValue(child)]));
}

interface QueryFilter {
  readonly field: string;
  readonly value: unknown;
  readonly operator: string;
}

export interface InMemoryTransactionReadTarget {
  readonly kind: "document" | "query";
  readonly path: string;
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

  get ref(): MemoryDocumentReference {
    return this.reference;
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
    protected readonly database?: InMemoryFirestore,
    readonly maximum?: number,
    readonly ordering: readonly { field: string; direction: "asc" | "desc" }[] = [],
    readonly cursor?: readonly unknown[],
    readonly group = false,
  ) {}

  where(field: string, operator: string, value: unknown): MemoryQuery {
    if (!["==", ">=", "<=", ">", "<", "array-contains"].includes(operator)) throw new Error(`Unsupported operator: ${operator}`);
    return new MemoryQuery(this.collectionPath, [
      ...this.filters,
      { field, value, operator },
    ], this.database, this.maximum, this.ordering, this.cursor, this.group);
  }

  limit(maximum: number): MemoryQuery {
    return new MemoryQuery(
      this.collectionPath,
      this.filters,
      this.database,
      maximum,
      this.ordering, this.cursor, this.group,
    );
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): MemoryQuery {
    return new MemoryQuery(this.collectionPath, this.filters, this.database, this.maximum, [...this.ordering, { field, direction }], this.cursor, this.group);
  }

  startAfter(...values: readonly unknown[]): MemoryQuery {
    return new MemoryQuery(this.collectionPath, this.filters, this.database, this.maximum, this.ordering, values, this.group);
  }

  execute(database: InMemoryFirestore): MemoryQuerySnapshot {
    const fieldValue = (document: { path: string; value: StoredDocument }, field: string) =>
      field === "__name__" ? (this.group ? document.path : document.path.split("/").at(-1)) : valueAt(document.value, field);
    const compare = (a: unknown, b: unknown): number => a === b ? 0 : (a as string | number) < (b as string | number) ? -1 : 1;
    let records = (this.group ? database.documentsInGroup(this.collectionPath) : database.documentsInCollection(this.collectionPath))
      .filter((document) => this.filters.every(({ field, operator, value }) => {
        const actual = fieldValue(document, field);
        if (actual === undefined) return false;
        if (operator === "array-contains") return Array.isArray(actual) && actual.includes(value);
        const order = compare(actual, value);
        return operator === "==" ? order === 0 : operator === ">=" ? order >= 0 : operator === "<=" ? order <= 0 : operator === ">" ? order > 0 : order < 0;
      }));
    if (this.ordering.length > 0) {
      records = records.filter((document) => this.ordering.every(({ field }) => fieldValue(document, field) !== undefined))
        .sort((left, right) => {
          for (const { field, direction } of this.ordering) {
            const order = compare(fieldValue(left, field), fieldValue(right, field));
            if (order !== 0) return direction === "asc" ? order : -order;
          }
          return compare(left.path, right.path);
        });
      if (this.cursor !== undefined) records = records.filter((document) => {
        for (let index = 0; index < this.cursor!.length; index += 1) {
          const { field, direction } = this.ordering[index];
          const order = compare(fieldValue(document, field), this.cursor![index]);
          if (order !== 0) return direction === "asc" ? order > 0 : order < 0;
        }
        return false;
      });
    }
    return new MemoryQuerySnapshot(records.slice(0, this.maximum).map(({ path, value }) => new MemoryDocumentSnapshot(new MemoryDocumentReference(path, database), value)));
  }

  async get(): Promise<MemoryQuerySnapshot> {
    if (this.database === undefined) {
      throw new Error("MEMORY_QUERY_DATABASE_NOT_BOUND");
    }
    return this.execute(this.database);
  }
}

class MemoryCollectionReference extends MemoryQuery {
  readonly collectionKind = "collection";

  constructor(
    readonly path: string,
    database?: InMemoryFirestore,
  ) {
    super(path, [], database);
  }

  doc(id: string): MemoryDocumentReference {
    return new MemoryDocumentReference(`${this.path}/${id}`, this.database);
  }

  get id(): string { return this.path.split("/").at(-1) ?? ""; }
  get parent(): MemoryDocumentReference | null {
    const segments = this.path.split("/");
    return segments.length < 2 ? null : new MemoryDocumentReference(segments.slice(0, -1).join("/"), this.database);
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

  get parent(): MemoryCollectionReference {
    return new MemoryCollectionReference(this.path.split("/").slice(0, -1).join("/"), this.database);
  }

  async set(value: StoredDocument, options?: { merge?: boolean }): Promise<void> {
    if (this.database === undefined) throw new Error("MEMORY_DOCUMENT_DATABASE_NOT_BOUND");
    this.database.write(this.path, value, options?.merge === true);
  }

  async delete(): Promise<void> {
    if (this.database === undefined) throw new Error("MEMORY_DOCUMENT_DATABASE_NOT_BOUND");
    this.database.remove(this.path);
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

  async create(value: StoredDocument): Promise<void> {
    if (this.database === undefined) {
      throw new Error("MEMORY_DOCUMENT_DATABASE_NOT_BOUND");
    }
    if (this.database.has(this.path)) {
      const error = new Error(`ALREADY_EXISTS:${this.path}`) as Error & {
        code?: number;
      };
      error.code = 6;
      throw error;
    }
    this.database.write(this.path, value, false);
  }

  async update(value: StoredDocument): Promise<void> {
    if (this.database === undefined) {
      throw new Error("MEMORY_DOCUMENT_DATABASE_NOT_BOUND");
    }
    if (!this.database.has(this.path)) throw new Error("NOT_FOUND");
    this.database.write(this.path, value, true);
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

  async getAll(
    ...targets: readonly MemoryDocumentReference[]
  ): Promise<readonly MemoryDocumentSnapshot[]> {
    return Promise.all(
      targets.map(async (target) => {
        const snapshot = await this.get(target);
        if (!(snapshot instanceof MemoryDocumentSnapshot)) {
          throw new Error("MEMORY_GET_ALL_DOCUMENT_REQUIRED");
        }
        return snapshot;
      }),
    );
  }

  async get(
    target: MemoryDocumentReference | MemoryCollectionReference | MemoryQuery,
  ): Promise<MemoryDocumentSnapshot | MemoryQuerySnapshot> {
    if (target instanceof MemoryDocumentReference) {
      this.database.recordTransactionRead({
        kind: "document",
        path: target.path,
      });
      return new MemoryDocumentSnapshot(
        target,
        this.database.document(target.path),
      );
    }
    this.database.recordTransactionRead({
      kind: "query",
      path: target.collectionPath,
    });
    return target.execute(this.database);
  }

  set(
    reference: MemoryDocumentReference,
    value: StoredDocument,
    options?: { readonly merge?: boolean },
  ): this {
    this.writes.push({
      kind: "set",
      path: reference.path,
      value: firestoreWriteValue(value) as StoredDocument,
      merge: options?.merge === true,
      requireAbsent: false,
    });
    return this;
  }

  create(reference: MemoryDocumentReference, value: StoredDocument): this {
    this.writes.push({
      kind: "set",
      path: reference.path,
      value: firestoreWriteValue(value) as StoredDocument,
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
  private readonly reads: InMemoryTransactionReadTarget[] = [];

  collection(path: string): MemoryCollectionReference {
    return new MemoryCollectionReference(path, this);
  }

  collectionGroup(name: string): MemoryQuery {
    return new MemoryQuery(name, [], this, undefined, [], undefined, true);
  }

  documentsInGroup(name: string): readonly { path: string; value: StoredDocument }[] {
    return [...this.documents.entries()].filter(([path]) => path.split("/").at(-2) === name)
      .map(([path, value]) => ({ path, value: structuredClone(value) }));
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

  recordTransactionRead(target: InMemoryTransactionReadTarget): void {
    this.reads.push(target);
  }

  clearTransactionReads(): void {
    this.reads.length = 0;
  }

  transactionReads(): readonly InMemoryTransactionReadTarget[] {
    return this.reads.map((target) => ({ ...target }));
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
    const next = merge && current !== undefined ? structuredClone(current) : {};
    for (const [key, child] of Object.entries(firestoreWriteValue(value) as StoredDocument)) {
      if (typeof child === "object" && child !== null && "__memoryFieldValue" in child && child.__memoryFieldValue === "delete") delete next[key];
      else next[key] = child;
    }
    this.documents.set(path, next);
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
