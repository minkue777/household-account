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
  const selectionVisibility = data.selectionVisibility === 'hidden' ? 'hidden' : 'visible';
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
      selectionVisibility,
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

export function subscribeToAssetOwnerProfiles(
  householdId: string,
  listener: (profiles: AssetOwnerProfileView[]) => void,
  onError?: (error: Error) => void
): () => void {
  if (householdId.trim() === '') {
    listener([]);
    return () => {};
  }

  let active = true;
  const profiles = collection(db, 'households', householdId, 'assetOwnerProfiles');
  const stop = onSnapshot(
    profiles,
    (snapshot) => {
      if (!active) return;
      const mappedProfiles = snapshot.docs
        .map((document, index) => mapProfile(householdId, document, index))
        .filter((entry): entry is OrderedProfile => entry !== undefined)
        .sort(compareEntryOrder)
        .map(({ profile }) => profile);
      listener(mappedProfiles);
    },
    (error) => {
      if (!active) return;
      onError?.(error instanceof Error ? error : new Error('ASSET_OWNER_PROFILE_READ_FAILED'));
    }
  );
  return () => { active = false; stop(); };
}
