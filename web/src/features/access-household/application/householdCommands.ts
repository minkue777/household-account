import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';

export const householdCommands = {
  resolveSignedInUser() {
    return getHouseholdCommandClient().execute('access.resolve-signed-in-user.v1', {});
  },

  claimLegacyMembership(candidate: {
    legacyHouseholdId: string;
    legacyMemberId: string;
    legacyMemberName?: string;
  }) {
    return getHouseholdCommandClient().execute('access.claim-legacy-membership.v1', candidate);
  },

  createWithSelf(householdName: string, memberName: string) {
    return getHouseholdCommandClient().execute(
      'access.create-household-with-self.v1',
      { householdName, memberName }
    );
  },

  joinAsSelf(invitationCode: string, memberName: string) {
    return getHouseholdCommandClient().execute(
      'access.join-household-as-self.v1',
      { invitationCode, memberName }
    );
  },

  createInvitation(householdId: string) {
    return getHouseholdCommandClient().execute('access.create-invitation.v1', {}, { householdId });
  },

  async renameSelf(
    householdId: string,
    displayName: string,
    expectedVersion: number
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'access.rename-self.v1',
      { displayName, expectedVersion },
      { householdId }
    );
  },

  async deleteHousehold(householdId: string): Promise<void> {
    await getHouseholdCommandClient().execute(
      'access.request-household-deletion.v1',
      {},
      { householdId }
    );
  },

  createAssetOwnerProfile(householdId: string, displayName: string) {
    return getHouseholdCommandClient().execute(
      'access.create-asset-owner-profile.v1',
      { displayName },
      { householdId }
    );
  },

  renameAssetOwnerProfile(
    householdId: string,
    profileId: string,
    displayName: string,
    expectedVersion: number
  ) {
    return getHouseholdCommandClient().execute(
      'access.rename-asset-owner-profile.v1',
      { profileId, displayName, expectedVersion },
      { householdId }
    );
  },

  archiveAssetOwnerProfile(
    householdId: string,
    profileId: string,
    expectedVersion: number
  ) {
    return getHouseholdCommandClient().execute(
      'access.archive-asset-owner-profile.v1',
      { profileId, expectedVersion },
      { householdId }
    );
  },

};
