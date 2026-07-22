import type { AssetOwnerProfileReadPort } from '@/features/access-household/application/assetOwnerProfileQueries';
import type { AssetOwnerProfileView } from '@/features/access-household/domain/assetOwnerProfile';
import {
  collection,
  db,
  onSnapshot,
  timestampToDate,
  type DocumentData,
  type QueryDocumentSnapshot,
} from './firestoreReadModel';

interface OrderedProfile {
  profile: AssetOwnerProfileView;
  createdAtMillis?: number;
  sourceOrder: number;
}

function mapProfile(
  householdId: string,
  snapshot: QueryDocumentSnapshot<DocumentData>,
  sourceOrder: number
): OrderedProfile | undefined {
  const data = snapshot.data();
  const displayName = typeof data.displayName === 'string' ? data.displayName : undefined;
  const profileType = data.profileType;
  const lifecycleState = data.lifecycleState ?? 'active';
  if (
    displayName === undefined ||
    displayName.trim() === '' ||
    (profileType !== 'member' && profileType !== 'dependent') ||
    (lifecycleState !== 'active' && lifecycleState !== 'archived')
  ) {
    return undefined;
  }

  const aggregateVersion =
    Number.isInteger(data.aggregateVersion) && data.aggregateVersion > 0
      ? data.aggregateVersion
      : 1;
  const linkedMemberId =
    typeof data.linkedMemberId === 'string' && data.linkedMemberId.trim() !== ''
      ? data.linkedMemberId
      : undefined;
  const createdAt = timestampToDate(data.createdAt);

  return {
    profile: {
      profileId: snapshot.id,
      householdId,
      displayName,
      profileType,
      ...(linkedMemberId === undefined ? {} : { linkedMemberId }),
      lifecycleState,
      aggregateVersion,
    },
    ...(createdAt === undefined ? {} : { createdAtMillis: createdAt.getTime() }),
    sourceOrder,
  };
}

function compareEntryOrder(left: OrderedProfile, right: OrderedProfile): number {
  if (left.createdAtMillis !== undefined && right.createdAtMillis !== undefined) {
    return left.createdAtMillis - right.createdAtMillis;
  }
  if (left.createdAtMillis !== undefined) return -1;
  if (right.createdAtMillis !== undefined) return 1;
  return left.sourceOrder - right.sourceOrder;
}

export class FirestoreAssetOwnerProfileReadModel implements AssetOwnerProfileReadPort {
  subscribeActive(
    householdId: string,
    listener: (profiles: AssetOwnerProfileView[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    if (householdId.trim() === '') {
      listener([]);
      return () => {};
    }

    const profiles = collection(db, 'households', householdId, 'assetOwnerProfiles');
    return onSnapshot(
      profiles,
      (snapshot) => {
        const activeProfiles = snapshot.docs
          .map((document, index) => mapProfile(householdId, document, index))
          .filter((entry): entry is OrderedProfile => entry !== undefined)
          .filter(({ profile }) => profile.lifecycleState === 'active')
          .sort(compareEntryOrder)
          .map(({ profile }) => profile);
        listener(activeProfiles);
      },
      (error) => {
        onError?.(error instanceof Error ? error : new Error('ASSET_OWNER_PROFILE_READ_FAILED'));
      }
    );
  }
}
