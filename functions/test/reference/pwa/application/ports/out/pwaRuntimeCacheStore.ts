import type { PwaRuntimeCacheEntry } from "../../../domain/model/pwaRuntimeCache";

export interface PwaRuntimeCacheStore {
  put(entry: PwaRuntimeCacheEntry): Promise<void>;
  get(requestUrl: string): Promise<PwaRuntimeCacheEntry | undefined>;
  remove(requestUrl: string): Promise<void>;
  entries(): readonly PwaRuntimeCacheEntry[];
}
