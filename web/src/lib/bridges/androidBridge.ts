import { WindowWithBridge } from '@/types/household';

/**
 * Android WebView 브리지 헬퍼
 */
export const AndroidBridge = {
  /**
   * Android 브리지 사용 가능 여부
   */
  isAvailable: (): boolean => {
    if (typeof window === 'undefined') return false;
    const bridge = (window as WindowWithBridge).AndroidBridge;
    return bridge !== undefined;
  },

  /**
   * 가구 키 설정 (SharedPreferences에 저장)
   */
  setHouseholdKey: (key: string): void => {
    if (typeof window === 'undefined') return;
    const bridge = (window as WindowWithBridge).AndroidBridge;
    if (bridge && typeof bridge.setHouseholdKey === 'function') {
      bridge.setHouseholdKey(key);
    }
  },

  /**
   * 가구 키 가져오기 (SharedPreferences에서)
   */
  getHouseholdKey: (): string | null => {
    if (typeof window === 'undefined') return null;
    const bridge = (window as WindowWithBridge).AndroidBridge;
    if (bridge && typeof bridge.getHouseholdKey === 'function') {
      return bridge.getHouseholdKey();
    }
    return null;
  },

  /**
   * 가구 키 삭제 (SharedPreferences에서)
   */
  clearHouseholdKey: (): void => {
    if (typeof window === 'undefined') return;
    const bridge = (window as WindowWithBridge).AndroidBridge;
    if (bridge && typeof bridge.clearHouseholdKey === 'function') {
      bridge.clearHouseholdKey();
    }
  },

  /**
   * 현재 설치된 안드로이드 앱 버전 조회
   */
  getAppVersion: (): string | null => {
    if (typeof window === 'undefined') return null;
    const bridge = (window as WindowWithBridge).AndroidBridge;
    if (bridge && typeof bridge.getAppVersion === 'function') {
      return bridge.getAppVersion();
    }
    return null;
  },
};
