import {
  AdminAccessClient,
  FirebaseCallableAdminAccessTransport,
} from '@/platform/functions-api';

const client = new AdminAccessClient(new FirebaseCallableAdminAccessTransport());

export const adminHouseholds = {
  list(cursor?: string, limit = 50) {
    return client.execute('list-households', { ...(cursor ? { cursor } : {}), limit });
  },
  create(name: string) {
    return client.execute('create-household', { name });
  },
  getLegacyShareKey(householdId: string) {
    return client.execute('get-legacy-share-key', { householdId });
  },
  delete(householdId: string, expectedVersion: number) {
    return client.execute('delete-household', {
      householdId,
      confirmed: true,
      expectedVersion,
    });
  },
  restore(householdId: string, expectedVersion: number, reason: string) {
    return client.execute('restore-household', {
      householdId,
      expectedVersion,
      reason,
    });
  },
  listMembers(householdId: string) {
    return client.execute('list-household-members', { householdId });
  },
  removeMember(
    householdId: string,
    memberId: string,
    expectedVersion: number,
    reason: string
  ) {
    return client.execute('remove-household-member', {
      householdId,
      memberId,
      expectedVersion,
      reason,
    });
  },
  restoreMember(householdId: string, memberId: string, expectedVersion: number) {
    return client.execute('restore-household-member', {
      householdId,
      memberId,
      expectedVersion,
    });
  },
  listDeletedAssets(householdId: string) {
    return client.execute('list-deleted-assets', { householdId });
  },
  restoreDeletedAsset(
    householdId: string,
    assetId: string,
    expectedVersion: number,
    auditReason: string
  ) {
    return client.execute('restore-deleted-asset', {
      householdId,
      assetId,
      expectedVersion,
      auditReason,
    });
  },
};
