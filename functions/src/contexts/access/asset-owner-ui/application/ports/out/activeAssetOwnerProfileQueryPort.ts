import type { ActiveOwnerProfileSummary } from "../../../domain/policies/assetOwnerUiSurfacePolicy";

export interface ActiveAssetOwnerProfileQueryPort {
  listActiveProfiles(principalRef: string): Promise<
    readonly ActiveOwnerProfileSummary[]
  >;
}
