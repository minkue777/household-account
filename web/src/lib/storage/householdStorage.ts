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
   * 가구 키 저장 (legacy migration 전용)
   */
  set: (key: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, key);
  },

  /**
   * 가구 키 삭제
   */
  clear: (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  },
};
