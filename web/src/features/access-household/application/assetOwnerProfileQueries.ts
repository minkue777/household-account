import type { AssetOwnerProfileView } from '../domain/assetOwnerProfile';

export interface AssetOwnerProfileReadPort {
  subscribe(
    householdId: string,
    listener: (profiles: AssetOwnerProfileView[]) => void,
    onError?: (error: Error) => void
  ): () => void;
}

export class AssetOwnerProfileQueries {
  constructor(private readonly readModel: AssetOwnerProfileReadPort) {}

  subscribe(
    householdId: string,
    listener: (profiles: AssetOwnerProfileView[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    return this.readModel.subscribe(householdId, listener, onError);
  }
}
