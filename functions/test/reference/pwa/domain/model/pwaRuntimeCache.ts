export interface PwaRuntimeCacheCandidate {
  readonly requestUrl: string;
  readonly requestMethod: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly requestMode: "navigate" | "cors" | "same-origin";
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly responseStatus: number;
  readonly responseContentType: string;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly receivedAt: string;
  readonly bodyMarker: string;
}

export type PwaCacheAdmissionDecision =
  | { readonly kind: "Cached"; readonly expiresAt: string }
  | { readonly kind: "NetworkOnly" };

export type PwaOfflineReadResult =
  | {
      readonly kind: "CacheHit";
      readonly bodyMarker: string;
      readonly originalReceivedAt: string;
    }
  | { readonly kind: "NetworkUnavailable" };

export interface PwaRuntimeCacheEntry {
  readonly cacheKey: string;
  readonly requestUrl: string;
  readonly bodyMarker: string;
  readonly receivedAt: string;
  readonly expiresAt: string;
}

export interface PwaRuntimeCacheState {
  readonly cachedUrls: readonly string[];
  readonly cacheKeys: readonly string[];
}
