import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';

export const notificationCommands = {
  async registerEndpoint(
    householdId: string,
    fid: string,
    platform: 'ios-pwa' | 'android',
    deviceInfo?: { model?: string; osVersion?: string; appVersion?: string }
  ) {
    return getHouseholdCommandClient().execute(
      'notifications.register-endpoint.v1',
      { fid, platform, ...(deviceInfo ? { deviceInfo } : {}) },
      { householdId }
    );
  },

  removeEndpointForLogout(householdId: string, fid: string) {
    return getHouseholdCommandClient().execute(
      'notifications.remove-endpoint.v1',
      { fid, reason: 'logout' },
      { householdId }
    );
  },

  removeEndpointForSdkUnregistered(
    householdId: string,
    fid: string,
    expectedRegistrationVersion: number
  ) {
    return getHouseholdCommandClient().execute(
      'notifications.remove-endpoint.v1',
      { fid, reason: 'sdk-unregistered', expectedRegistrationVersion },
      { householdId }
    );
  },
};
