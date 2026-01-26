/**
 * @jest-environment node
 */
import { Platform } from '@/lib/utils/platform';

describe('Platform (Node environment - SSR)', () => {
  describe('isServer', () => {
    it('should return true in node environment', () => {
      expect(Platform.isServer()).toBe(true);
    });
  });

  describe('isClient', () => {
    it('should return false in node environment', () => {
      expect(Platform.isClient()).toBe(false);
    });
  });

  describe('isIOS', () => {
    it('should return false in node environment', () => {
      expect(Platform.isIOS()).toBe(false);
    });
  });

  describe('isIOSPWA', () => {
    it('should return false in node environment', () => {
      expect(Platform.isIOSPWA()).toBe(false);
    });
  });

  describe('supportsNotification', () => {
    it('should return false in node environment', () => {
      expect(Platform.supportsNotification()).toBe(false);
    });
  });

  describe('supportsPushNotification', () => {
    it('should return false in node environment', () => {
      expect(Platform.supportsPushNotification()).toBe(false);
    });
  });
});
