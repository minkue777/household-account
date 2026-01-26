import { AndroidBridge } from '../bridges/androidBridge';

const STORAGE_KEY = 'householdKey';

/**
 * localStorage 기반 가구 키 저장소
 */
export const HouseholdStorage = {
  /**
   * 가구 키 가져오기
   */
  get: (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
  },

  /**
   * 가구 키 저장
   * Android 브리지가 있으면 SharedPreferences에도 동기화
   */
  set: (key: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, key);
    // Android WebView 브리지가 있으면 SharedPreferences에도 동기화
    AndroidBridge.setHouseholdKey(key);
  },

  /**
   * 가구 키 삭제
   * Android 브리지가 있으면 SharedPreferences에서도 삭제
   */
  clear: (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
    // Android WebView 브리지가 있으면 SharedPreferences에서도 삭제
    AndroidBridge.clearHouseholdKey();
  },
};
