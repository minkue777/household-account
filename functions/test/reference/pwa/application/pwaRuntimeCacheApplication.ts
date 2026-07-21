import type {
  PwaCacheAdmissionDecision,
  PwaOfflineReadResult,
  PwaRuntimeCacheState,
} from "../domain/model/pwaRuntimeCache";
import {
  canReadPwaRuntimeCacheEntryPolicy,
  evaluatePwaRuntimeCacheAdmissionPolicy,
  type PwaRuntimeCacheConfiguration,
} from "../domain/policies/pwaRuntimeCachePolicy";
import type { PwaRuntimeCacheInputPort } from "./ports/in/pwaRuntimeCacheInputPort";
import type { PwaRuntimeCacheStore } from "./ports/out/pwaRuntimeCacheStore";

function normalizedRequestUrl(value: string): string | undefined {
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

export function createPwaRuntimeCacheApplication(dependencies: {
  readonly configuration: PwaRuntimeCacheConfiguration;
  readonly store: PwaRuntimeCacheStore;
}): PwaRuntimeCacheInputPort {
  return {
    async receive(candidate): Promise<PwaCacheAdmissionDecision> {
      const admission = evaluatePwaRuntimeCacheAdmissionPolicy({
        candidate,
        configuration: dependencies.configuration,
      });
      if (!("entry" in admission)) {
        return admission.decision;
      }
      await dependencies.store.put(admission.entry);
      return admission.decision;
    },

    async readOffline(
      requestUrl,
      at,
    ): Promise<PwaOfflineReadResult> {
      const normalizedUrl = normalizedRequestUrl(requestUrl);
      if (normalizedUrl === undefined || !Number.isFinite(Date.parse(at))) {
        return { kind: "NetworkUnavailable" };
      }
      const entry = await dependencies.store.get(normalizedUrl);
      if (entry === undefined) return { kind: "NetworkUnavailable" };
      if (
        !canReadPwaRuntimeCacheEntryPolicy({
          entry,
          requestUrl: normalizedUrl,
          at,
          configuration: dependencies.configuration,
        })
      ) {
        await dependencies.store.remove(normalizedUrl);
        return { kind: "NetworkUnavailable" };
      }
      return {
        kind: "CacheHit",
        bodyMarker: entry.bodyMarker,
        originalReceivedAt: entry.receivedAt,
      };
    },

    state(): PwaRuntimeCacheState {
      const entries = [...dependencies.store.entries()].sort((left, right) =>
        left.requestUrl.localeCompare(right.requestUrl),
      );
      return {
        cachedUrls: entries.map(({ requestUrl }) => requestUrl),
        cacheKeys: entries.map(({ cacheKey }) => cacheKey),
      };
    },
  };
}
