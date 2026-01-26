/**
 * @jest-environment jsdom
 */

// Firebase Firestore mock
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => 'households-collection'),
  doc: jest.fn((col, id) => ({ id })),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  deleteDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'server-timestamp'),
}));

jest.mock('@/lib/firebase', () => ({
  db: {},
}));

jest.mock('@/lib/storage/householdStorage', () => ({
  HouseholdStorage: {
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
  },
}));

import {
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { HouseholdStorage } from '@/lib/storage/householdStorage';
import {
  createHousehold,
  validateHouseholdKey,
  getHousehold,
  getAllHouseholds,
  deleteHousehold,
  getStoredHouseholdKey,
  setStoredHouseholdKey,
  clearStoredHouseholdKey,
} from '@/lib/householdService';

describe('householdService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createHousehold', () => {
    it('should create household with custom key', async () => {
      (getDoc as jest.Mock).mockResolvedValue({ exists: () => false });
      (setDoc as jest.Mock).mockResolvedValue(undefined);

      const key = await createHousehold('Test Family', 'custom-key-123');

      expect(key).toBe('custom-key-123');
      expect(setDoc).toHaveBeenCalled();
    });

    it('should generate random key if not provided', async () => {
      (getDoc as jest.Mock).mockResolvedValue({ exists: () => false });
      (setDoc as jest.Mock).mockResolvedValue(undefined);

      const key = await createHousehold('Test Family');

      expect(key).toHaveLength(20);
      expect(setDoc).toHaveBeenCalled();
    });

    it('should regenerate key if already exists', async () => {
      let callCount = 0;
      (getDoc as jest.Mock).mockImplementation(() => {
        callCount++;
        return Promise.resolve({ exists: () => callCount < 3 }); // 처음 2번은 존재, 3번째부터 미존재
      });
      (setDoc as jest.Mock).mockResolvedValue(undefined);

      const key = await createHousehold('Test Family');

      expect(key).toHaveLength(20);
      expect(getDoc).toHaveBeenCalledTimes(3);
    });
  });

  describe('validateHouseholdKey', () => {
    it('should return true for existing key', async () => {
      (getDoc as jest.Mock).mockResolvedValue({ exists: () => true });

      const result = await validateHouseholdKey('existing-key');

      expect(result).toBe(true);
    });

    it('should return false for non-existing key', async () => {
      (getDoc as jest.Mock).mockResolvedValue({ exists: () => false });

      const result = await validateHouseholdKey('non-existing-key');

      expect(result).toBe(false);
    });
  });

  describe('getHousehold', () => {
    it('should return household data for existing key', async () => {
      const mockDate = new Date('2024-01-01');
      (getDoc as jest.Mock).mockResolvedValue({
        exists: () => true,
        id: 'test-key',
        data: () => ({
          name: 'Test Family',
          createdAt: { toDate: () => mockDate },
        }),
      });

      const result = await getHousehold('test-key');

      expect(result).toEqual({
        id: 'test-key',
        name: 'Test Family',
        createdAt: mockDate,
      });
    });

    it('should return null for non-existing key', async () => {
      (getDoc as jest.Mock).mockResolvedValue({ exists: () => false });

      const result = await getHousehold('non-existing-key');

      expect(result).toBeNull();
    });

    it('should handle missing createdAt', async () => {
      (getDoc as jest.Mock).mockResolvedValue({
        exists: () => true,
        id: 'test-key',
        data: () => ({
          name: 'Test Family',
          createdAt: null,
        }),
      });

      const result = await getHousehold('test-key');

      expect(result?.name).toBe('Test Family');
      expect(result?.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('getAllHouseholds', () => {
    it('should return all households', async () => {
      const mockDate = new Date('2024-01-01');
      (getDocs as jest.Mock).mockResolvedValue({
        docs: [
          {
            id: 'key1',
            data: () => ({ name: 'Family 1', createdAt: { toDate: () => mockDate } }),
          },
          {
            id: 'key2',
            data: () => ({ name: 'Family 2', createdAt: null }),
          },
        ],
      });

      const result = await getAllHouseholds();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('key1');
      expect(result[1].id).toBe('key2');
    });
  });

  describe('deleteHousehold', () => {
    it('should delete household', async () => {
      (deleteDoc as jest.Mock).mockResolvedValue(undefined);

      await deleteHousehold('key-to-delete');

      expect(deleteDoc).toHaveBeenCalled();
    });
  });

  describe('localStorage functions', () => {
    it('getStoredHouseholdKey should call HouseholdStorage.get', () => {
      (HouseholdStorage.get as jest.Mock).mockReturnValue('stored-key');

      const result = getStoredHouseholdKey();

      expect(HouseholdStorage.get).toHaveBeenCalled();
      expect(result).toBe('stored-key');
    });

    it('setStoredHouseholdKey should call HouseholdStorage.set', () => {
      setStoredHouseholdKey('new-key');

      expect(HouseholdStorage.set).toHaveBeenCalledWith('new-key');
    });

    it('clearStoredHouseholdKey should call HouseholdStorage.clear', () => {
      clearStoredHouseholdKey();

      expect(HouseholdStorage.clear).toHaveBeenCalled();
    });
  });
});
