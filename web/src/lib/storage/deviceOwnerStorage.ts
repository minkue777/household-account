/**
 * localStorage 기반 기기 주인 저장소
 * 이 기기가 누구 것인지 저장 (망고/또니)
 * 안드로이드 = 망고, 아이폰 = 또니 (자동 감지)
 */

const STORAGE_KEY = 'deviceOwner';

export type DeviceOwner = '망고' | '또니';

/**
 * iOS 기기인지 확인
 */
function isIOSDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const userAgent = navigator.userAgent || navigator.vendor;
  return /iPad|iPhone|iPod/.test(userAgent);
}

export const DeviceOwnerStorage = {
  /**
   * 기기 주인 가져오기 (자동 감지)
   * 아이폰 = 또니, 안드로이드 = 망고
   */
  get(): DeviceOwner {
    if (typeof window === 'undefined') return '망고';

    // 이미 저장된 값이 있으면 사용
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === '망고' || stored === '또니') {
      return stored;
    }

    // 자동 감지: iOS = 또니, 그 외 = 망고
    const owner: DeviceOwner = isIOSDevice() ? '또니' : '망고';
    localStorage.setItem(STORAGE_KEY, owner);
    return owner;
  },

  /**
   * 기기 주인 저장하기
   */
  set(owner: DeviceOwner): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, owner);
  },

  /**
   * 기기 주인 삭제하기
   */
  remove(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  },
};
