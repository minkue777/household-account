import { AssetOwnerProfileQueries } from '@/features/access-household/application/assetOwnerProfileQueries';
import { FirestoreAssetOwnerProfileReadModel } from '@/platform/read-model/firestoreAssetOwnerProfileReadModel';

let queries: AssetOwnerProfileQueries | undefined;

export function getAssetOwnerProfileQueries(): AssetOwnerProfileQueries {
  queries ??= new AssetOwnerProfileQueries(new FirestoreAssetOwnerProfileReadModel());
  return queries;
}
