import { getHouseholdQueryClient } from '@/composition/webQueryRuntime';
import { householdCommands } from './householdCommands';

export const assetOwnerProfiles = {
  list(householdId: string, includeArchived = false) {
    return getHouseholdQueryClient().execute(
      'access.list-asset-owner-profiles.v1',
      { includeArchived },
      { householdId }
    );
  },
  create(householdId: string, displayName: string) {
    return householdCommands.createAssetOwnerProfile(householdId, displayName);
  },
  rename(
    householdId: string,
    profileId: string,
    displayName: string,
    expectedVersion: number
  ) {
    return householdCommands.renameAssetOwnerProfile(
      householdId,
      profileId,
      displayName,
      expectedVersion
    );
  },
  archive(householdId: string, profileId: string, expectedVersion: number) {
    return householdCommands.archiveAssetOwnerProfile(householdId, profileId, expectedVersion);
  },
};
