import type {
  PwaCacheAdmissionDecision,
  PwaOfflineReadResult,
  PwaRuntimeCacheCandidate,
  PwaRuntimeCacheState,
} from "../../../domain/model/pwaRuntimeCache";

export type {
  PwaCacheAdmissionDecision,
  PwaOfflineReadResult,
  PwaRuntimeCacheCandidate,
  PwaRuntimeCacheEntry,
  PwaRuntimeCacheState,
} from "../../../domain/model/pwaRuntimeCache";

export interface PwaRuntimeCacheInputPort {
  receive(
    candidate: PwaRuntimeCacheCandidate,
  ): Promise<PwaCacheAdmissionDecision>;
  readOffline(requestUrl: string, at: string): Promise<PwaOfflineReadResult>;
  state(): PwaRuntimeCacheState;
}
