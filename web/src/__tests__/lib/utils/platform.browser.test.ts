/**
 * @jest-environment jsdom
 */
import { Platform } from '@/lib/utils/platform';

describe('Platform (Browser environment)', () => {
  describe('isServer', () => {
    it('should return false in browser', () => {
      expect(Platform.isServer()).toBe(false);
    });
  });

  describe('isClient', () => {
    it('should return true in browser', () => {
      expect(Platform.isClient()).toBe(true);
    });
  });

  describe('isIOS', () => {
    const originalUserAgent = navigator.userAgent;

    afterEach(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
    });

    it('should return true for iPhone userAgent', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)',
        configurable: true,
      });
      expect(Platform.isIOS()).toBe(true);
    });

    it('should return true for iPad userAgent', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPad; CPU OS 14_0)',
        configurable: true,
      });
      expect(Platform.isIOS()).toBe(true);
    });

    it('should return true for iPod userAgent', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPod; CPU iPhone OS 14_0)',
        configurable: true,
      });
      expect(Platform.isIOS()).toBe(true);
    });

    it('should return false for Android userAgent', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 11)',
        configurable: true,
      });
      expect(Platform.isIOS()).toBe(false);
    });

    it('should return false for Windows userAgent', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        configurable: true,
      });
      expect(Platform.isIOS()).toBe(false);
    });
  });

  describe('isIOSPWA', () => {
    const originalUserAgent = navigator.userAgent;

    afterEach(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
      // standalone property cleanup
      delete (navigator as any).standalone;
    });

    it('should return true for iOS with standalone mode', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)',
        configurable: true,
      });
      Object.defineProperty(navigator, 'standalone', {
        value: true,
        configurable: true,
      });
      expect(Platform.isIOSPWA()).toBe(true);
    });

    it('should return false for iOS without standalone mode', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)',
        configurable: true,
      });
      Object.defineProperty(navigator, 'standalone', {
        value: false,
        configurable: true,
      });
      expect(Platform.isIOSPWA()).toBe(false);
    });

    it('should return false for non-iOS with standalone mode', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 11)',
        configurable: true,
      });
      Object.defineProperty(navigator, 'standalone', {
        value: true,
        configurable: true,
      });
      expect(Platform.isIOSPWA()).toBe(false);
    });
  });

  describe('supportsNotification', () => {
    it('should return true when Notification exists', () => {
      // JSDOM에서 Notification이 기본적으로 존재하지 않음
      (window as any).Notification = {};
      expect(Platform.supportsNotification()).toBe(true);
      delete (window as any).Notification;
    });

    it('should return false when Notification does not exist', () => {
      const originalNotification = (window as any).Notification;
      delete (window as any).Notification;
      expect(Platform.supportsNotification()).toBe(false);
      if (originalNotification) {
        (window as any).Notification = originalNotification;
      }
    });
  });

  describe('supportsPushNotification', () => {
    it('should return true when all features exist', () => {
      (window as any).Notification = {};
      (window as any).PushManager = {};
      // serviceWorker는 JSDOM에서 이미 존재할 수 있음
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {},
        configurable: true,
      });
      expect(Platform.supportsPushNotification()).toBe(true);
      delete (window as any).Notification;
      delete (window as any).PushManager;
    });

    it('should return false when Notification is missing', () => {
      delete (window as any).Notification;
      (window as any).PushManager = {};
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {},
        configurable: true,
      });
      expect(Platform.supportsPushNotification()).toBe(false);
      delete (window as any).PushManager;
    });
  });
});
