import { createPwaRuntimeCacheApplication } from "../reference/pwa/application/pwaRuntimeCacheApplication";
import type { PwaRuntimeCacheStore } from "../reference/pwa/application/ports/out/pwaRuntimeCacheStore";
import type {
  PwaRuntimeCacheEntry,
  PwaRuntimeCacheInputPort,
} from "../reference/pwa/public";

export type {
  PwaCacheAdmissionDecision,
  PwaOfflineReadResult,
  PwaRuntimeCacheCandidate,
  PwaRuntimeCacheState,
} from "../reference/pwa/public";

export interface PwaRuntimeCacheFixture {
  readonly origin?: string;
  readonly publicRuntimeAllowlist?: readonly string[];
}

export interface PwaRuntimeCacheDriver extends PwaRuntimeCacheInputPort {}

class InMemoryPwaRuntimeCacheStore implements PwaRuntimeCacheStore {
  private readonly values = new Map<string, PwaRuntimeCacheEntry>();

  async put(entry: PwaRuntimeCacheEntry): Promise<void> {
    this.values.set(entry.requestUrl, structuredClone(entry));
  }

  async get(requestUrl: string): Promise<PwaRuntimeCacheEntry | undefined> {
    const entry = this.values.get(requestUrl);
    return entry === undefined ? undefined : structuredClone(entry);
  }

  async remove(requestUrl: string): Promise<void> {
    this.values.delete(requestUrl);
  }

  entries(): readonly PwaRuntimeCacheEntry[] {
    return [...this.values.values()].map((entry) => structuredClone(entry));
  }
}

export function createPwaRuntimeCacheDriver(
  fixture: PwaRuntimeCacheFixture = {},
): PwaRuntimeCacheDriver {
  return createPwaRuntimeCacheApplication({
    configuration: {
      origin: fixture.origin ?? "https://household.example",
      publicRuntimeAllowlist: fixture.publicRuntimeAllowlist ?? [],
      cacheNamespace: "household-public-runtime-v1",
    },
    store: new InMemoryPwaRuntimeCacheStore(),
  });
}
