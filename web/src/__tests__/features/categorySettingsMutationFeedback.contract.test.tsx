import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CategorySettings from '@/components/settings/CategorySettings';
import { useAppDialog } from '@/contexts/AppDialogContext';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useHousehold } from '@/contexts/HouseholdContext';
import type { CategoryDocument } from '@/types/category';
import { subscribeToCategoryCatalogVersion } from '@/lib/categoryService';
import { setDefaultCategoryKey } from '@/lib/householdService';

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
  subscribeToCategoryCatalogVersion: jest.fn(),
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

function pointer(target: HTMLElement, type: string, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientY });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'touch' },
    isPrimary: { value: true },
  });
  fireEvent(target, event);
}

describe('CategorySettings mutation feedback contract', () => {
  const showAlert = jest.fn().mockResolvedValue(undefined);
  const addCategory = jest.fn();
  const reorderCategories = jest.fn();
  let emitCatalogVersion: (version: number, defaultCategoryKey?: string) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(subscribeToCategoryCatalogVersion).mockImplementation((_id, callback) => {
      emitCatalogVersion = callback;
      callback(7);
      return jest.fn();
    });
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
      serverSnapshotReady: true,
      readError: null,
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

  test('[T-CAT-007][CAT-002] 터치 이동을 한 번 저장하고 저장 중 중복 이동을 막으며 실패를 안내한다', async () => {
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
      serverSnapshotReady: true,
      readError: null,
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

    const first = screen.getByRole('button', { name: '식비 순서 이동' });
    const second = screen.getByRole('button', { name: '교통비 순서 이동' });
    first.setPointerCapture = jest.fn();
    const firstRow = first.closest('[data-category-id]') as HTMLElement;
    const secondRow = second.closest('[data-category-id]') as HTMLElement;
    jest.spyOn(firstRow, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 80 } as DOMRect);
    jest.spyOn(secondRow, 'getBoundingClientRect').mockReturnValue({ top: 180, height: 80 } as DOMRect);

    pointer(first, 'pointerdown', 140);
    pointer(first, 'pointermove', 220);
    expect(firstRow).toHaveStyle({ transform: 'translateY(80px)' });
    expect(reorderCategories).not.toHaveBeenCalled();
    pointer(first, 'pointerup', 220);

    expect(reorderCategories).toHaveBeenCalledTimes(1);
    expect(reorderCategories).toHaveBeenCalledWith([secondCategory, firstCategory], 7);
    expect(first).toBeDisabled();
    expect(second).toBeDisabled();

    pointer(second, 'pointerdown', 220);
    pointer(second, 'pointermove', 140);
    pointer(second, 'pointerup', 140);
    expect(reorderCategories).toHaveBeenCalledTimes(1);

    await act(async () => {
      command.reject(new Error('CATEGORY_REORDER_FAILED'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(showAlert).toHaveBeenCalled();
      expect(first).toBeEnabled();
      expect(second).toBeEnabled();
    });

    consoleError.mockRestore();
  });

  test('[T-CAT-007][CAT-002] 취소한 터치는 저장하지 않고, 저장 성공 뒤 최신 버전을 받은 다음 연속 이동한다', async () => {
    const firstCategory = category();
    const secondCategory = category({ id: 'category-2', key: 'transport', label: '교통비', order: 1 });
    const context = mockedUseCategoryContext();
    mockedUseCategoryContext.mockReturnValue({
      ...context,
      categories: [firstCategory, secondCategory],
      activeCategories: [firstCategory, secondCategory],
    });
    reorderCategories.mockResolvedValue(undefined);
    const { rerender } = render(<CategorySettings />);
    fireEvent.click(screen.getByRole('button', { name: /카테고리/ }));
    const first = screen.getByRole('button', { name: '식비 순서 이동' });
    const second = screen.getByRole('button', { name: '교통비 순서 이동' });
    first.setPointerCapture = jest.fn();
    jest.spyOn(first.closest('[data-category-id]')!, 'getBoundingClientRect')
      .mockReturnValue({ top: 100, height: 80 } as DOMRect);
    jest.spyOn(second.closest('[data-category-id]')!, 'getBoundingClientRect')
      .mockReturnValue({ top: 180, height: 80 } as DOMRect);
    pointer(first, 'pointerdown', 140);
    pointer(first, 'pointermove', 220);
    pointer(first, 'pointercancel', 220);
    pointer(first, 'pointerup', 220);
    expect(reorderCategories).not.toHaveBeenCalled();

    await act(async () => { fireEvent.keyDown(first, { key: 'ArrowDown' }); });
    expect(reorderCategories).toHaveBeenCalledWith([secondCategory, firstCategory], 7);
    // callable 응답이 먼저 도착해도 버전 7로 다시 저장하지 않습니다.
    expect(first).toBeDisabled();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(reorderCategories).toHaveBeenCalledTimes(1);

    mockedUseCategoryContext.mockReturnValue({
      ...context,
      categories: [secondCategory, firstCategory],
      activeCategories: [secondCategory, firstCategory],
    });
    rerender(<CategorySettings />);
    act(() => emitCatalogVersion(8));
    expect(first).toBeEnabled();
    await act(async () => { fireEvent.keyDown(first, { key: 'ArrowUp' }); });
    expect(reorderCategories).toHaveBeenLastCalledWith([firstCategory, secondCategory], 8);
    expect(reorderCategories).toHaveBeenCalledTimes(2);
  });

  test('재진입 때 실제 기본 카테고리를 구독하고 같은 기본값 선택으로 대기 상태에 빠지지 않는다', () => {
    mockedUseHousehold.mockReturnValue({
      household: { id: 'house-1', defaultCategoryKey: 'old-category' },
    } as unknown as ReturnType<typeof useHousehold>);
    render(<CategorySettings />);
    fireEvent.click(screen.getByRole('button', { name: /카테고리/ }));
    act(() => emitCatalogVersion(9, 'food'));
    expect(screen.getByText('기본', { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('기본 카테고리로 설정'));
    expect(setDefaultCategoryKey).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '식비 순서 이동' })).toBeEnabled();
  });
});
