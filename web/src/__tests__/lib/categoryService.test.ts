/**
 * @jest-environment jsdom
 */

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => 'categories-collection'),
  doc: jest.fn((db, col, id) => ({ id: id || 'new-doc-id' })),
  addDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  onSnapshot: jest.fn(),
  query: jest.fn(),
  orderBy: jest.fn(),
  getDocs: jest.fn(),
  writeBatch: jest.fn(() => ({
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  })),
  where: jest.fn(),
}));

jest.mock('@/lib/firebase', () => ({
  db: {},
}));

import {
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';
import {
  initializeDefaultCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  setBudget,
  reorderCategories,
  subscribeToCategories,
  generateCategoryKey,
  COLOR_PALETTE,
} from '@/lib/categoryService';

describe('categoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeDefaultCategories', () => {
    it('should not initialize if householdId is empty', async () => {
      await initializeDefaultCategories('');

      expect(getDocs).not.toHaveBeenCalled();
    });

    it('should initialize default categories if none exist', async () => {
      (getDocs as jest.Mock).mockResolvedValue({ empty: true });

      await initializeDefaultCategories('test-household');

      expect(getDocs).toHaveBeenCalled();
      expect(writeBatch).toHaveBeenCalled();
    });

    it('should not initialize if categories already exist', async () => {
      (getDocs as jest.Mock).mockResolvedValue({ empty: false });

      await initializeDefaultCategories('test-household');

      expect(writeBatch).not.toHaveBeenCalled();
    });
  });

  describe('addCategory', () => {
    it('should add category with householdId', async () => {
      (addDoc as jest.Mock).mockResolvedValue({ id: 'new-category-id' });

      const category = {
        key: 'custom',
        label: 'Custom Category',
        color: '#FF0000',
        budget: 100000,
        order: 5,
        isActive: true,
      };

      const result = await addCategory(category, 'test-household');

      expect(addDoc).toHaveBeenCalled();
      expect(result).toBe('new-category-id');
    });
  });

  describe('updateCategory', () => {
    it('should update category', async () => {
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await updateCategory('cat-id', { label: 'Updated Label' });

      expect(updateDoc).toHaveBeenCalledWith(
        { id: 'cat-id' },
        { label: 'Updated Label' }
      );
    });
  });

  describe('deleteCategory', () => {
    it('should delete category', async () => {
      (deleteDoc as jest.Mock).mockResolvedValue(undefined);

      await deleteCategory('cat-id');

      expect(deleteDoc).toHaveBeenCalled();
    });
  });

  describe('setBudget', () => {
    it('should set budget for category', async () => {
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await setBudget('cat-id', 150000);

      expect(updateDoc).toHaveBeenCalledWith(
        { id: 'cat-id' },
        { budget: 150000 }
      );
    });

    it('should clear budget with null', async () => {
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await setBudget('cat-id', null);

      expect(updateDoc).toHaveBeenCalledWith(
        { id: 'cat-id' },
        { budget: null }
      );
    });
  });

  describe('reorderCategories', () => {
    it('should update order for multiple categories', async () => {
      const mockBatch = {
        update: jest.fn(),
        commit: jest.fn().mockResolvedValue(undefined),
      };
      (writeBatch as jest.Mock).mockReturnValue(mockBatch);

      await reorderCategories([
        { id: 'cat-1', order: 0 },
        { id: 'cat-2', order: 1 },
        { id: 'cat-3', order: 2 },
      ]);

      expect(mockBatch.update).toHaveBeenCalledTimes(3);
      expect(mockBatch.commit).toHaveBeenCalled();
    });
  });

  describe('subscribeToCategories', () => {
    it('should return empty callback for empty householdId', () => {
      const callback = jest.fn();

      const unsubscribe = subscribeToCategories('', callback);

      expect(callback).toHaveBeenCalledWith([]);
      expect(unsubscribe).toBeInstanceOf(Function);
    });

    it('should subscribe to categories', () => {
      const callback = jest.fn();
      const mockUnsubscribe = jest.fn();
      (onSnapshot as jest.Mock).mockImplementation((q, onNext) => {
        onNext({
          docs: [
            { id: 'cat-1', data: () => ({ key: 'food', label: 'Food' }) },
          ],
        });
        return mockUnsubscribe;
      });

      const unsubscribe = subscribeToCategories('test-household', callback);

      expect(callback).toHaveBeenCalled();
      expect(unsubscribe).toBe(mockUnsubscribe);
    });

    it('should handle subscription errors', () => {
      const callback = jest.fn();
      const mockUnsubscribe = jest.fn();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      (onSnapshot as jest.Mock).mockImplementation((q, onNext, onError) => {
        onError(new Error('Subscription error'));
        return mockUnsubscribe;
      });

      subscribeToCategories('test-household', callback);

      expect(callback).toHaveBeenCalledWith([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('generateCategoryKey', () => {
    it('should generate key with timestamp format', () => {
      const key = generateCategoryKey();

      expect(key).toMatch(/^custom_\d+$/);
    });

    it('should generate different keys with time gap', async () => {
      const key1 = generateCategoryKey();
      await new Promise(resolve => setTimeout(resolve, 5));
      const key2 = generateCategoryKey();

      expect(key1).not.toBe(key2);
    });
  });

  describe('COLOR_PALETTE', () => {
    it('should have 12 colors', () => {
      expect(COLOR_PALETTE).toHaveLength(12);
    });

    it('should have valid hex colors', () => {
      COLOR_PALETTE.forEach(color => {
        expect(color).toMatch(/^#[0-9A-F]{6}$/i);
      });
    });
  });
});
