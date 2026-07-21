import {
  isAndroidHostAvailable,
  requestAndroidHost,
} from '@/platform/android-host/androidHostBridge';

/** UI 호환 facade. Native transport 세부사항은 platform 경계에 격리합니다. */
export const AndroidBridge = {
  isAvailable: isAndroidHostAvailable,

  async getAppVersion(): Promise<string | null> {
    if (!isAndroidHostAvailable()) return null;
    const result = await requestAndroidHost('app.get-version', {});
    return result.version;
  },

  async isQuickEditOverlayEnabled(householdId: string, memberId: string): Promise<boolean> {
    if (!isAndroidHostAvailable()) return true;
    const result = await requestAndroidHost('quick-edit.get-overlay-enabled', {
      householdId,
      memberId,
    });
    return result.enabled;
  },

  async setQuickEditOverlayEnabled(
    householdId: string,
    memberId: string,
    enabled: boolean
  ): Promise<void> {
    if (!isAndroidHostAvailable()) return;
    await requestAndroidHost('quick-edit.set-overlay-enabled', {
      householdId,
      memberId,
      enabled,
    });
  },
};
