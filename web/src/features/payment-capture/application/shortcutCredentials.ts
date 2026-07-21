import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import { getHouseholdQueryClient } from '@/composition/webQueryRuntime';

export function shortcutAuthorizationValue(rawCredential: string): string {
  return `Bearer ${rawCredential}`;
}

export const shortcutCredentials = {
  status() {
    return getHouseholdQueryClient().execute('shortcut.get-credential-status.v1', {});
  },

  issue() {
    return getHouseholdCommandClient().execute('shortcut.issue-credential.v1', {});
  },

  reissue(currentCredentialId: string, expectedVersion: number) {
    return getHouseholdCommandClient().execute('shortcut.reissue-credential.v1', {
      currentCredentialId,
      expectedVersion,
    });
  },

  revoke(credentialId: string, expectedVersion: number) {
    return getHouseholdCommandClient().execute('shortcut.revoke-credential.v1', {
      credentialId,
      expectedVersion,
    });
  },
};
