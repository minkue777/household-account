/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { CategoryProvider, useCategoryContext } from '@/contexts/CategoryContext';
import * as categoryService from '@/lib/categoryService';
import * as householdService from '@/lib/householdService';

jest.mock('@/lib/categoryService', () => ({
  subscribeToCategories: jest.fn(),
  initializeDefaultCategories: jest.fn(),
  addCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
  setBudget: jest.fn(),
  reorderCategories: jest.fn(),
  generateCategoryKey: jest.fn(() => 'custom_123'),
}));

jest.mock('@/lib/householdService', () => ({
  getStoredHouseholdKey: jest.fn(() => 'test-household'),
}));

const mockCategories = [
  { id: 'cat1', key: 'food', label: '식비', color: '#FBBF24', budget: 500000, order: 0, isDefault: true, isActive: true, householdId: 'test-household' },
  { id: 'cat2', key: 'living', label: '생활비', color: '#4ADE80', budget: 300000, order: 1, isDefault: true, isActive: true, householdId: 'test-household' },
  { id: 'cat3', key: 'etc', label: '기타', color: '#9CA3AF', budget: null, order: 2, isDefault: true, isActive: false, householdId: 'test-household' },
];

// 테스트용 컴포넌트
function TestComponent() {
  const {
    categories,
    isLoading,
    getCategoryByKey,
    getCategoryLabel,
    getCategoryColor,
    getCategoryBudget,
    categoryLabels,
    categoryColors,
    activeCategories,
    addCategory,
    updateCategory,
    deleteCategory,
    setBudget,
  } = useCategoryContext();

  if (isLoading) return <div data-testid="loading">Loading...</div>;

  return (
    <div>
      <span data-testid="count">{categories.length}</span>
      <span data-testid="active-count">{activeCategories.length}</span>
      <span data-testid="food-label">{getCategoryLabel('food')}</span>
      <span data-testid="food-color">{getCategoryColor('food')}</span>
      <span data-testid="food-budget">{getCategoryBudget('food') ?? 'null'}</span>
      <span data-testid="unknown-label">{getCategoryLabel('unknown')}</span>
      <span data-testid="unknown-color">{getCategoryColor('unknown')}</span>
      <span data-testid="labels-food">{categoryLabels['food']}</span>
      <span data-testid="colors-food">{categoryColors['food']}</span>
      <button onClick={() => addCategory('새 카테고리', '#FF0000', 100000)}>Add</button>
      <button onClick={() => updateCategory('cat1', { label: 'Updated' })}>Update</button>
      <button onClick={() => deleteCategory('cat1')}>Delete</button>
      <button onClick={() => setBudget('cat1', 600000)}>Set Budget</button>
    </div>
  );
}

describe('CategoryContext', () => {
  let mockUnsubscribe: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUnsubscribe = jest.fn();
    (categoryService.initializeDefaultCategories as jest.Mock).mockResolvedValue(undefined);
    (categoryService.subscribeToCategories as jest.Mock).mockImplementation((householdId, callback) => {
      setTimeout(() => callback(mockCategories), 0);
      return mockUnsubscribe;
    });
  });

  describe('CategoryProvider', () => {
    it('should load and display categories', async () => {
      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('count')).toHaveTextContent('3');
      });

      expect(categoryService.initializeDefaultCategories).toHaveBeenCalledWith('test-household');
      expect(categoryService.subscribeToCategories).toHaveBeenCalledWith('test-household', expect.any(Function));
    });

    it('should filter active categories', async () => {
      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('active-count')).toHaveTextContent('2');
      });
    });

    it('should provide getCategoryLabel helper', async () => {
      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('food-label')).toHaveTextContent('식비');
      });
    });

    it('should return default for unknown category', async () => {
      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('unknown-label')).toHaveTextContent('알 수 없음');
        expect(screen.getByTestId('unknown-color')).toHaveTextContent('#6B7280');
      });
    });

    it('should provide getCategoryColor helper', async () => {
      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('food-color')).toHaveTextContent('#FBBF24');
      });
    });

    it('should provide getCategoryBudget helper', async () => {
      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('food-budget')).toHaveTextContent('500000');
      });
    });

    it('should provide categoryLabels map', async () => {
      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('labels-food')).toHaveTextContent('식비');
      });
    });

    it('should provide categoryColors map', async () => {
      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('colors-food')).toHaveTextContent('#FBBF24');
      });
    });

    it('should call addCategory service', async () => {
      (categoryService.addCategory as jest.Mock).mockResolvedValue('new-cat-id');

      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      const addButton = screen.getByText('Add');

      await act(async () => {
        addButton.click();
      });

      expect(categoryService.addCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'custom_123',
          label: '새 카테고리',
          color: '#FF0000',
          budget: 100000,
        }),
        'test-household'
      );
    });

    it('should call updateCategory service', async () => {
      (categoryService.updateCategory as jest.Mock).mockResolvedValue(undefined);

      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      const updateButton = screen.getByText('Update');

      await act(async () => {
        updateButton.click();
      });

      expect(categoryService.updateCategory).toHaveBeenCalledWith('cat1', { label: 'Updated' });
    });

    it('should call deleteCategory service', async () => {
      (categoryService.deleteCategory as jest.Mock).mockResolvedValue(undefined);

      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      const deleteButton = screen.getByText('Delete');

      await act(async () => {
        deleteButton.click();
      });

      expect(categoryService.deleteCategory).toHaveBeenCalledWith('cat1');
    });

    it('should call setBudget service', async () => {
      (categoryService.setBudget as jest.Mock).mockResolvedValue(undefined);

      render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      const setBudgetButton = screen.getByText('Set Budget');

      await act(async () => {
        setBudgetButton.click();
      });

      expect(categoryService.setBudget).toHaveBeenCalledWith('cat1', 600000);
    });

    it('should unsubscribe on unmount', async () => {
      const { unmount } = render(
        <CategoryProvider>
          <TestComponent />
        </CategoryProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('useCategoryContext', () => {
    it('should throw error when used outside provider', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useCategoryContext must be used within a CategoryProvider');

      consoleErrorSpy.mockRestore();
    });
  });
});
