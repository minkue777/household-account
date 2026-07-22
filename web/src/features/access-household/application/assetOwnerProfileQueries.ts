import type { AssetOwnerProfileView } from '../domain/assetOwnerProfile';

export interface AssetOwnerProfileReadPort {
  subscribeActive(
    householdId: string,
    listener: (profiles: AssetOwnerProfileView[]) => void,
    onError?: (error: Error) => void
  ): () => void;
}

export class AssetOwnerProfileQueries {
  constructor(private readonly readModel: AssetOwnerProfileReadPort) {}

  subscribeActive(
    householdId: string,
    listener: (profiles: AssetOwnerProfileView[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    return this.readModel.subscribeActive(householdId, listener, onError);
  }
}
