/**
 * @jest-environment jsdom
 */
import { AndroidBridge } from '@/lib/bridges/androidBridge';
import { WindowWithBridge } from '@/types/household';

describe('AndroidBridge', () => {
  beforeEach(() => {
    // AndroidBridge 정리
    delete (window as any).AndroidBridge;
  });

  afterEach(() => {
    delete (window as any).AndroidBridge;
  });

  describe('isAvailable', () => {
    it('should return true when AndroidBridge exists on window', () => {
      (window as WindowWithBridge).AndroidBridge = {
        setHouseholdKey: jest.fn(),
        getHouseholdKey: jest.fn(),
        clearHouseholdKey: jest.fn(),
        setMemberName: jest.fn(),
        setPartnerName: jest.fn(),
      };

      expect(AndroidBridge.isAvailable()).toBe(true);
    });

    it('should return false when AndroidBridge does not exist', () => {
      expect(AndroidBridge.isAvailable()).toBe(false);
    });
  });

  describe('setHouseholdKey', () => {
    it('should call bridge setHouseholdKey when available', () => {
      const mockSetHouseholdKey = jest.fn();
      (window as WindowWithBridge).AndroidBridge = {
        setHouseholdKey: mockSetHouseholdKey,
        getHouseholdKey: jest.fn(),
        clearHouseholdKey: jest.fn(),
        setMemberName: jest.fn(),
        setPartnerName: jest.fn(),
      };

      AndroidBridge.setHouseholdKey('test-key');

      expect(mockSetHouseholdKey).toHaveBeenCalledWith('test-key');
    });

    it('should not throw when bridge is not available', () => {
      expect(() => AndroidBridge.setHouseholdKey('test-key')).not.toThrow();
    });

    it('should not call if function is not defined', () => {
      (window as any).AndroidBridge = {};
      expect(() => AndroidBridge.setHouseholdKey('test-key')).not.toThrow();
    });
  });

  describe('getHouseholdKey', () => {
    it('should return key from bridge when available', () => {
      const mockGetHouseholdKey = jest.fn().mockReturnValue('stored-key');
      (window as WindowWithBridge).AndroidBridge = {
        setHouseholdKey: jest.fn(),
        getHouseholdKey: mockGetHouseholdKey,
        clearHouseholdKey: jest.fn(),
        setMemberName: jest.fn(),
        setPartnerName: jest.fn(),
      };

      const result = AndroidBridge.getHouseholdKey();

      expect(mockGetHouseholdKey).toHaveBeenCalled();
      expect(result).toBe('stored-key');
    });

    it('should return null when bridge is not available', () => {
      expect(AndroidBridge.getHouseholdKey()).toBeNull();
    });

    it('should return null if function is not defined', () => {
      (window as any).AndroidBridge = {};
      expect(AndroidBridge.getHouseholdKey()).toBeNull();
    });
  });

  describe('clearHouseholdKey', () => {
    it('should call bridge clearHouseholdKey when available', () => {
      const mockClearHouseholdKey = jest.fn();
      (window as WindowWithBridge).AndroidBridge = {
        setHouseholdKey: jest.fn(),
        getHouseholdKey: jest.fn(),
        clearHouseholdKey: mockClearHouseholdKey,
        setMemberName: jest.fn(),
        setPartnerName: jest.fn(),
      };

      AndroidBridge.clearHouseholdKey();

      expect(mockClearHouseholdKey).toHaveBeenCalled();
    });

    it('should not throw when bridge is not available', () => {
      expect(() => AndroidBridge.clearHouseholdKey()).not.toThrow();
    });
  });
});
