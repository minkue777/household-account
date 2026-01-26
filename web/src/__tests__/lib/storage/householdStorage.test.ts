/**
 * @jest-environment jsdom
 */
import { HouseholdStorage } from '@/lib/storage/householdStorage';
import { AndroidBridge } from '@/lib/bridges/androidBridge';

// Mock AndroidBridge
jest.mock('@/lib/bridges/androidBridge', () => ({
  AndroidBridge: {
    setHouseholdKey: jest.fn(),
    clearHouseholdKey: jest.fn(),
  },
}));

describe('HouseholdStorage', () => {
  beforeEach(() => {
    // localStorage 초기화
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('should return stored household key', () => {
      localStorage.setItem('householdKey', 'test-household-key');

      const result = HouseholdStorage.get();

      expect(result).toBe('test-household-key');
    });

    it('should return null when no key stored', () => {
      const result = HouseholdStorage.get();

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should store household key in localStorage', () => {
      HouseholdStorage.set('new-household-key');

      expect(localStorage.getItem('householdKey')).toBe('new-household-key');
    });

    it('should sync to Android bridge', () => {
      HouseholdStorage.set('new-household-key');

      expect(AndroidBridge.setHouseholdKey).toHaveBeenCalledWith('new-household-key');
    });
  });

  describe('clear', () => {
    it('should remove household key from localStorage', () => {
      localStorage.setItem('householdKey', 'existing-key');

      HouseholdStorage.clear();

      expect(localStorage.getItem('householdKey')).toBeNull();
    });

    it('should sync clear to Android bridge', () => {
      HouseholdStorage.clear();

      expect(AndroidBridge.clearHouseholdKey).toHaveBeenCalled();
    });
  });
});
