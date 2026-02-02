/**
 * 플랫폼 감지 유틸리티
 */
export const Platform = {
  /**
   * iOS 디바이스 여부
   */
  isIOS: (): boolean => {
    if (typeof window === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  },

  /**
   * iOS PWA (홈 화면에 추가) 여부
   */
  isIOSPWA: (): boolean => {
    if (typeof window === 'undefined') return false;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    return isIOS && isStandalone;
  },

  /**
   * 브라우저 Notification API 지원 여부
   */
  supportsNotification: (): boolean => {
    if (typeof window === 'undefined') return false;
    return 'Notification' in window;
  },

  /**
   * 푸시 알림 지원 여부 (Notification + ServiceWorker + PushManager)
   */
  supportsPushNotification: (): boolean => {
    if (typeof window === 'undefined') return false;
    return 'Notification' in window &&
           'serviceWorker' in navigator &&
           'PushManager' in window;
  },

  /**
   * 모바일 디바이스 여부 (Android, iOS)
   */
  isMobile: (): boolean => {
    if (typeof window === 'undefined') return false;
    return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  },

  /**
   * 서버 환경 여부 (SSR)
   */
  isServer: (): boolean => {
    return typeof window === 'undefined';
  },

  /**
   * 클라이언트 환경 여부
   */
  isClient: (): boolean => {
    return typeof window !== 'undefined';
  },
};
