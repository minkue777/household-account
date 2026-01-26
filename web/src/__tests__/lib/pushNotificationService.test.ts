/**
 * @jest-environment jsdom
 */

jest.mock('firebase/messaging', () => ({
  getMessaging: jest.fn(),
  getToken: jest.fn(),
  onMessage: jest.fn(),
}));

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(),
  httpsCallable: jest.fn(),
}));

jest.mock('@/lib/firebase', () => ({
  app: {},
}));

jest.mock('@/lib/utils/platform', () => ({
  Platform: {
    isServer: jest.fn(() => false),
    isIOS: jest.fn(() => false),
    isIOSPWA: jest.fn(() => false),
    supportsNotification: jest.fn(() => true),
    supportsPushNotification: jest.fn(() => true),
  },
}));

import { getMessaging, onMessage } from 'firebase/messaging';
import { Platform } from '@/lib/utils/platform';
import {
  initializeMessaging,
  isPushNotificationSupported,
  getNotificationPermissionStatus,
  isIOSPWA,
  isIOS,
  setupForegroundMessageListener,
} from '@/lib/pushNotificationService';

describe('pushNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform.isServer as jest.Mock).mockReturnValue(false);
    (Platform.isIOS as jest.Mock).mockReturnValue(false);
    (Platform.isIOSPWA as jest.Mock).mockReturnValue(false);
    (Platform.supportsNotification as jest.Mock).mockReturnValue(true);
    (Platform.supportsPushNotification as jest.Mock).mockReturnValue(true);
  });

  describe('initializeMessaging', () => {
    it('should return null on server', () => {
      (Platform.isServer as jest.Mock).mockReturnValue(true);

      const result = initializeMessaging();

      expect(result).toBeNull();
      expect(getMessaging).not.toHaveBeenCalled();
    });

    it('should return null for iOS non-PWA', () => {
      (Platform.isIOS as jest.Mock).mockReturnValue(true);
      (Platform.isIOSPWA as jest.Mock).mockReturnValue(false);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = initializeMessaging();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        'iOS에서는 홈 화면에 추가한 PWA에서만 푸시 알림이 지원됩니다.'
      );

      consoleSpy.mockRestore();
    });

    it('should initialize messaging for iOS PWA', () => {
      (Platform.isIOS as jest.Mock).mockReturnValue(true);
      (Platform.isIOSPWA as jest.Mock).mockReturnValue(true);
      const mockMessaging = { name: 'messaging' };
      (getMessaging as jest.Mock).mockReturnValue(mockMessaging);

      const result = initializeMessaging();

      expect(getMessaging).toHaveBeenCalled();
      expect(result).toBe(mockMessaging);
    });

    it('should initialize messaging for non-iOS', () => {
      const mockMessaging = { name: 'messaging' };
      (getMessaging as jest.Mock).mockReturnValue(mockMessaging);

      const result = initializeMessaging();

      expect(getMessaging).toHaveBeenCalled();
      expect(result).toBe(mockMessaging);
    });

    it('should handle initialization error', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      (getMessaging as jest.Mock).mockImplementation(() => {
        throw new Error('Init failed');
      });

      const result = initializeMessaging();

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('isPushNotificationSupported', () => {
    it('should return Platform.supportsPushNotification result', () => {
      (Platform.supportsPushNotification as jest.Mock).mockReturnValue(true);
      expect(isPushNotificationSupported()).toBe(true);

      (Platform.supportsPushNotification as jest.Mock).mockReturnValue(false);
      expect(isPushNotificationSupported()).toBe(false);
    });
  });

  describe('getNotificationPermissionStatus', () => {
    it('should return null on server', () => {
      (Platform.isServer as jest.Mock).mockReturnValue(true);

      const result = getNotificationPermissionStatus();

      expect(result).toBeNull();
    });

    it('should return null if notification not supported', () => {
      (Platform.supportsNotification as jest.Mock).mockReturnValue(false);

      const result = getNotificationPermissionStatus();

      expect(result).toBeNull();
    });

    it('should return Notification.permission', () => {
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'granted' },
        writable: true,
      });

      const result = getNotificationPermissionStatus();

      expect(result).toBe('granted');
    });
  });

  describe('isIOSPWA', () => {
    it('should return Platform.isIOSPWA result', () => {
      (Platform.isIOSPWA as jest.Mock).mockReturnValue(true);
      expect(isIOSPWA()).toBe(true);

      (Platform.isIOSPWA as jest.Mock).mockReturnValue(false);
      expect(isIOSPWA()).toBe(false);
    });
  });

  describe('isIOS', () => {
    it('should return Platform.isIOS result', () => {
      (Platform.isIOS as jest.Mock).mockReturnValue(true);
      expect(isIOS()).toBe(true);

      (Platform.isIOS as jest.Mock).mockReturnValue(false);
      expect(isIOS()).toBe(false);
    });
  });

  describe('setupForegroundMessageListener', () => {
    it('should setup message listener when messaging is available', () => {
      const mockMessaging = { name: 'messaging' };
      (getMessaging as jest.Mock).mockReturnValue(mockMessaging);
      const mockUnsubscribe = jest.fn();
      (onMessage as jest.Mock).mockReturnValue(mockUnsubscribe);

      // 먼저 messaging 초기화
      initializeMessaging();

      const callback = jest.fn();
      const unsubscribe = setupForegroundMessageListener(callback);

      expect(onMessage).toHaveBeenCalled();
      expect(unsubscribe).toBe(mockUnsubscribe);
    });
  });
});
