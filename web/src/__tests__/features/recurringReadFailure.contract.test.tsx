import { act, fireEvent, render, screen } from '@testing-library/react';
import RecurringExpenseSettings from '@/components/settings/RecurringExpenseSettings';
import { subscribeToRecurringExpenses } from '@/lib/recurringExpenseService';
import { onSnapshot } from '@/platform/read-model/firestoreReadModel';
import type { RecurringExpense } from '@/types/recurring';

const mockHousehold = { householdKey: 'house', remoteReadEpoch: 0 };

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({ activeCategories: [], getCategoryLabel: () => '식비', getCategoryColor: () => '#112233' }),
}));
jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: () => mockHousehold,
}));
jest.mock('@/features/recurring/application/recurringCommands', () => ({ recurringCommands: {} }));
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: {}, collection: jest.fn(), query: jest.fn(), where: jest.fn(), onSnapshot: jest.fn(),
}));

const plan = {
  id: 'plan', householdId: 'house', merchant: '보험료', amount: 1000,
  category: 'food', dayOfMonth: 10, isActive: true, aggregateVersion: 1,
};

describe('정기 지출의 읽기 실패와 정상 빈 목록 구분', () => {
  let emit: (snapshot: unknown) => void;
  let fail: (error: unknown) => void;
  let dispose: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHousehold.householdKey = 'house';
    mockHousehold.remoteReadEpoch = 0;
    dispose = jest.fn();
    jest.mocked(onSnapshot).mockImplementation((...args: unknown[]) => {
      emit = args[1] as typeof emit;
      fail = args[2] as typeof fail;
      return dispose;
    });
  });

  it('adapter는 실패를 빈 성공으로 바꾸지 않고 원인과 함께 전달한다', () => {
    const received = jest.fn<void, [RecurringExpense[]]>();
    const failed = jest.fn();
    const unsubscribe = subscribeToRecurringExpenses('house', received, failed);
    const error = new Error('unavailable');
    fail(error);
    expect(failed).toHaveBeenCalledWith(error);
    expect(received).not.toHaveBeenCalled();
    emit({ docs: [] });
    expect(received).toHaveBeenCalledWith([]);
    unsubscribe();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('화면은 마지막 정상 목록을 보존하고 재시도한 정상 빈 결과를 구분한다', () => {
    render(<RecurringExpenseSettings />);
    fireEvent.click(screen.getByRole('button', { name: /정기 지출/ }));
    act(() => emit({ docs: [{ id: 'plan', data: () => plan }] }));
    expect(screen.getByText('보험료')).toBeInTheDocument();
    act(() => fail(new Error('unavailable')));
    expect(screen.getByRole('alert')).toHaveTextContent('정기 지출을 불러오지 못했습니다.');
    expect(screen.getByText('보험료')).toBeInTheDocument();
    expect(screen.queryByText('등록된 정기 지출이 없습니다.')).not.toBeInTheDocument();
    const staleEmit = emit;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    act(() => staleEmit({ docs: [] }));
    expect(screen.queryByText('등록된 정기 지출이 없습니다.')).not.toBeInTheDocument();
    act(() => emit({ docs: [] }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('등록된 정기 지출이 없습니다.')).toBeInTheDocument();
  });

  it('가구 A 성공 뒤 B 조회 실패에서는 A 목록과 편집 상태를 보여주지 않는다', () => {
    const view = render(<RecurringExpenseSettings />);
    fireEvent.click(screen.getByRole('button', { name: /정기 지출/ }));
    act(() => emit({ docs: [{ id: 'plan', data: () => plan }] }));
    fireEvent.click(screen.getByRole('button', { name: '보험료 정기 지출 수정' }));
    expect(screen.getByDisplayValue('보험료')).toBeInTheDocument();
    const staleEmit = emit;

    mockHousehold.householdKey = 'house-b';
    view.rerender(<RecurringExpenseSettings />);
    act(() => fail(new Error('house-b unavailable')));
    act(() => staleEmit({ docs: [{ id: 'plan', data: () => plan }] }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('보험료')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('보험료')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '보험료 정기 지출 수정' })).not.toBeInTheDocument();
    expect(screen.queryByText('등록된 정기 지출이 없습니다.')).not.toBeInTheDocument();
  });

  it('같은 가구의 remote epoch 복구와 재시도 실패에서는 마지막 정상 목록을 보존한다', () => {
    const view = render(<RecurringExpenseSettings />);
    fireEvent.click(screen.getByRole('button', { name: /정기 지출/ }));
    act(() => emit({ docs: [{ id: 'plan', data: () => plan }] }));
    mockHousehold.remoteReadEpoch = 1;
    view.rerender(<RecurringExpenseSettings />);
    act(() => fail(new Error('remote unavailable')));
    expect(screen.getByText('보험료')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    act(() => fail(new Error('still unavailable')));
    expect(screen.getByText('보험료')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('최초 조회 실패도 등록된 내역이 없다는 성공 표시를 하지 않는다', () => {
    render(<RecurringExpenseSettings />);
    fireEvent.click(screen.getByRole('button', { name: /정기 지출/ }));
    act(() => fail(new Error('permission-denied')));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('등록된 정기 지출이 없습니다.')).not.toBeInTheDocument();
  });
});
