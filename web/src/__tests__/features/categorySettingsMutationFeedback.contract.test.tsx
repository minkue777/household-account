import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CategorySettings from '@/components/settings/CategorySettings';
import { useAppDialog } from '@/contexts/AppDialogContext';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useHousehold } from '@/contexts/HouseholdContext';
import type { CategoryDocument } from '@/types/category';

jest.mock('@/contexts/AppDialogContext', () => ({
  useAppDialog: jest.fn(),
}));

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: jest.fn(),
}));

jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: jest.fn(),
}));

jest.mock('@/lib/categoryService', () => ({
  COLOR_PALETTE: ['#4ADE80', '#F472B6'],
}));

jest.mock('@/lib/householdService', () => ({
  setDefaultCategoryKey: jest.fn(),
}));

jest.mock('@/components/common/ColorPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="color-picker" />,
}));

const mockedUseAppDialog = jest.mocked(useAppDialog);
const mockedUseCategoryContext = jest.mocked(useCategoryContext);
const mockedUseHousehold = jest.mocked(useHousehold);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function category(overrides: Partial<CategoryDocument> = {}): CategoryDocument {
  return {
    id: 'category-1',
    key: 'food',
    label: '식비',
    color: '#4ADE80',
    budget: null,
    order: 0,
    isDefault: true,
    isActive: true,
    householdId: 'house-1',
    ...overrides,
  };
}

function dataTransfer(): DataTransfer {
  return {
    effectAllowed: 'none',
    setData: jest.fn(),
  } as unknown as DataTransfer;
}

describe('CategorySettings mutation feedback contract', () => {
  const showAlert = jest.fn().mockResolvedValue(undefined);
  const addCategory = jest.fn();
  const reorderCategories = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAppDialog.mockReturnValue({
      showAlert,
      showConfirm: jest.fn(),
      showPrompt: jest.fn(),
    });
    mockedUseHousehold.mockReturnValue({
      household: {
        id: 'house-1',
        defaultCategoryKey: 'food',
      },
    } as unknown as ReturnType<typeof useHousehold>);
    mockedUseCategoryContext.mockReturnValue({
      categories: [category()],
      activeCategories: [category()],
      isLoading: false,
      addCategory,
      updateCategory: jest.fn(),
      deleteCategory: jest.fn(),
      setBudget: jest.fn(),
      reorderCategories,
      getCategoryByKey: jest.fn(),
      getCategoryLabel: jest.fn(),
      getCategoryColor: jest.fn(),
      getCategoryBudget: jest.fn(),
      categoryLabels: {},
      categoryColors: {},
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('추가 명령 중에는 추가 버튼을 비활성화하고 중복 제출을 막으며 실패를 안내한다', async () => {
    const command = deferred<string>();
    addCategory.mockReturnValue(command.promise);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();

    render(<CategorySettings />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /카테고리/ }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '새 카테고리 추가' }));
    });
    await act(async () => {
      await user.type(screen.getByPlaceholderText('카테고리명'), '교통비');
    });

    const submit = screen.getByRole('button', { name: '추가' });
    await act(async () => {
      await user.click(submit);
    });

    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(addCategory).toHaveBeenCalledWith('교통비', '#4ADE80', null);
    expect(submit).toBeDisabled();

    await act(async () => {
      await user.click(submit);
    });
    expect(addCategory).toHaveBeenCalledTimes(1);

    await act(async () => {
      command.reject(new Error('CATEGORY_CREATE_FAILED'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(showAlert).toHaveBeenCalled();
      expect(submit).toBeEnabled();
    });
    expect(screen.getByDisplayValue('교통비')).toBeInTheDocument();
  });

  test('순서 변경 명령 중에는 모든 category drag를 비활성화하고 중복 drop을 막으며 실패를 안내한다', async () => {
    const firstCategory = category();
    const secondCategory = category({
      id: 'category-2',
      key: 'transport',
      label: '교통비',
      order: 1,
      isDefault: false,
    });
    const command = deferred<void>();
    reorderCategories.mockReturnValue(command.promise);
    mockedUseCategoryContext.mockReturnValue({
      categories: [firstCategory, secondCategory],
      activeCategories: [firstCategory, secondCategory],
      isLoading: false,
      addCategory,
      updateCategory: jest.fn(),
      deleteCategory: jest.fn(),
      setBudget: jest.fn(),
      reorderCategories,
      getCategoryByKey: jest.fn(),
      getCategoryLabel: jest.fn(),
      getCategoryColor: jest.fn(),
      getCategoryBudget: jest.fn(),
      categoryLabels: {},
      categoryColors: {},
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();

    render(<CategorySettings />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /카테고리/ }));
    });

    const first = screen.getByRole('button', { name: '식비 수정' }).closest('[draggable]');
    const second = screen.getByRole('button', { name: '교통비 수정' }).closest('[draggable]');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    fireEvent.dragStart(first!, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(second!, { dataTransfer: dataTransfer() });
    fireEvent.drop(second!, { dataTransfer: dataTransfer() });

    expect(reorderCategories).toHaveBeenCalledTimes(1);
    expect(reorderCategories).toHaveBeenCalledWith([secondCategory, firstCategory]);
    expect(first).toHaveAttribute('draggable', 'false');
    expect(second).toHaveAttribute('draggable', 'false');

    fireEvent.dragStart(second!, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(first!, { dataTransfer: dataTransfer() });
    fireEvent.drop(first!, { dataTransfer: dataTransfer() });
    expect(reorderCategories).toHaveBeenCalledTimes(1);

    await act(async () => {
      command.reject(new Error('CATEGORY_REORDER_FAILED'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(showAlert).toHaveBeenCalled();
      expect(first).toHaveAttribute('draggable', 'true');
      expect(second).toHaveAttribute('draggable', 'true');
    });

    consoleError.mockRestore();
  });
});
