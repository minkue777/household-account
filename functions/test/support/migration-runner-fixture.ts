import { createMigrationRunnerApplication } from "../../src/operations/migration/application/migrationRunnerApplication";
import type {
  MigrationDocumentStore,
  MigrationPlanStore,
} from "../../src/operations/migration/application/ports/out/migrationRunnerPorts";
import type {
  MigrationDocument,
  MigrationPlan,
  MigrationResult,
} from "../../src/operations/migration/domain/migrationPlan";

export type { MigrationDocument, MigrationResult };

export interface MigrationRunnerFixtureSubject {
  clientCompositionExports(): readonly string[];
  run(input: {
    actor: "operations" | "client";
    migrationId: string;
    householdId: string;
    fromSchemaVersion: number;
    mode: "dry-run" | "apply";
    expectedPlanHash?: string;
    checkpoint?: string;
  }): Promise<MigrationResult>;
  documents(): readonly MigrationDocument[];
}

class FixtureMigrationStore implements MigrationDocumentStore, MigrationPlanStore {
  private current: MigrationDocument[];
  private readonly plans = new Map<string, MigrationPlan>();
  private successfulPageCount = 0;
  private failureInjected = false;

  constructor(
    documents: readonly MigrationDocument[],
    private readonly failAfterPages?: number,
  ) {
    this.current = documents.map((document) => ({ ...document }));
  }

  async list(): Promise<readonly MigrationDocument[]> {
    return this.current.map((document) => ({ ...document }));
  }

  async applyPage(input: {
    documentIds: readonly string[];
    fromSchemaVersion: number;
    toSchemaVersion: number;
  }): Promise<{ kind: "success" } | { kind: "retryable-failure" }> {
    if (
      !this.failureInjected &&
      this.failAfterPages !== undefined &&
      this.successfulPageCount >= this.failAfterPages
    ) {
      this.failureInjected = true;
      return { kind: "retryable-failure" };
    }
    const ids = new Set(input.documentIds);
    this.current = this.current.map((document) =>
      ids.has(document.documentId) &&
      document.schemaVersion === input.fromSchemaVersion
        ? { ...document, schemaVersion: input.toSchemaVersion }
        : document,
    );
    this.successfulPageCount += 1;
    return { kind: "success" };
  }

  async save(plan: MigrationPlan): Promise<void> {
    this.plans.set(plan.planHash, structuredClone(plan));
  }

  async find(planHash: string): Promise<MigrationPlan | undefined> {
    const plan = this.plans.get(planHash);
    return plan === undefined ? undefined : structuredClone(plan);
  }

  snapshot(): readonly MigrationDocument[] {
    return this.current.map((document) => ({ ...document }));
  }
}

function fixtureHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `sha256:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createMigrationRunnerFixture(fixture: {
  documents: readonly MigrationDocument[];
  pageSize?: number;
  failAfterPages?: number;
}): MigrationRunnerFixtureSubject {
  const store = new FixtureMigrationStore(
    fixture.documents,
    fixture.failAfterPages,
  );
  const application = createMigrationRunnerApplication({
    documents: store,
    plans: store,
    hasher: { hash: fixtureHash },
    pageSize: fixture.pageSize ?? 50,
  });
  return {
    clientCompositionExports: () => [],
    run: (input) => application.run(input),
    documents: () => store.snapshot(),
  };
}
