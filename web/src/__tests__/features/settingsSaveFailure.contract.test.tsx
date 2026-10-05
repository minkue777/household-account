import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CardSettings from '@/components/settings/CardSettings';
import RecurringExpenseSettings from '@/components/settings/RecurringExpenseSettings';

const mockCardAdd = jest.fn();
const mockRecurringUpdate = jest.fn();
const mockHousehold = { householdKey: 'house' };
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => mockHousehold }));
jest.mock('@/contexts/CategoryContext', () => ({ useCategoryContext: () => ({
  activeCategories: [{ key: 'food', label: '식비', color: '#000' }],
  getCategoryLabel: () => '식비', getCategoryColor: () => '#000',
}) }));
jest.mock('@/lib/registeredCardService', () => ({
  subscribeToRegisteredCards: (_scope: unknown, next: (cards: unknown[]) => void) => { next([]); return jest.fn(); },
  addRegisteredCard: (...args: unknown[]) => mockCardAdd(...args),
}));
jest.mock('@/lib/recurringExpenseService', () => ({
  subscribeToRecurringExpenses: (_house: string, next: (plans: unknown[]) => void) => {
    next([{ id: 'plan', merchant: '보험료', amount: 1000, category: 'food', dayOfMonth: 10, aggregateVersion: 3, isActive: true }]);
    return jest.fn();
  },
  updateRecurringExpense: (...args: unknown[]) => mockRecurringUpdate(...args),
}));

beforeEach(() => {
  mockHousehold.householdKey = 'house';
  mockCardAdd.mockReset();
  mockRecurringUpdate.mockReset();
  HTMLElement.prototype.scrollIntoView = jest.fn();
});

test('[CARD-001] 카드 등록 실패 후 입력을 유지하고 연속 저장을 한 번만 전송한다', async () => {
  let reject!: (error: Error) => void;
  mockCardAdd.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue('card');
  render(<CardSettings householdId="house" ownerMemberId="member" ownerName="본인" />);
  fireEvent.click(screen.getByRole('button', { name: /본인님 카드/ }));
  fireEvent.click(screen.getByRole('button', { name: '카드 등록' }));
  fireEvent.change(screen.getByPlaceholderText('예: 1234'), { target: { value: '1234' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(mockCardAdd).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('연결 실패')));
  expect(screen.getByRole('alert')).toHaveTextContent('연결 실패');
  expect(screen.getByDisplayValue('1234')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(screen.queryByDisplayValue('1234')).not.toBeInTheDocument());
  expect(mockCardAdd).toHaveBeenLastCalledWith({ householdId: 'house', owner: '본인', cardLabel: '삼성', cardLastFour: '1234' });
});

test('정기 계획 수정 실패 후 같은 version·초안을 재전송한다', async () => {
  mockRecurringUpdate.mockRejectedValueOnce(new Error('VERSION_MISMATCH')).mockResolvedValue(undefined);
  render(<RecurringExpenseSettings />);
  fireEvent.click(screen.getByRole('button', { name: /정기 지출/ }));
  fireEvent.click(screen.getByRole('button', { name: '보험료 정기 지출 수정' }));
  fireEvent.change(screen.getByDisplayValue('보험료'), { target: { value: '새 보험료' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('VERSION_MISMATCH');
  expect(screen.getByDisplayValue('새 보험료')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(screen.queryByDisplayValue('새 보험료')).not.toBeInTheDocument());
  expect(mockRecurringUpdate.mock.calls[0]).toEqual(mockRecurringUpdate.mock.calls[1]);
  expect(mockRecurringUpdate.mock.calls[0]).toEqual(['plan', expect.objectContaining({ merchant: '새 보험료' }), 3]);
});

test('가구 전환 전에 보낸 저장 결과가 새 가구의 편집 폼을 닫지 않는다', async () => {
  let resolve!: () => void;
  mockRecurringUpdate.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  const view = render(<RecurringExpenseSettings />);
  fireEvent.click(screen.getByRole('button', { name: /정기 지출/ }));
  fireEvent.click(screen.getByRole('button', { name: '보험료 정기 지출 수정' }));
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  mockHousehold.householdKey = 'other';
  view.rerender(<RecurringExpenseSettings />);
  fireEvent.click(screen.getByRole('button', { name: '보험료 정기 지출 수정' }));
  fireEvent.change(screen.getByDisplayValue('보험료'), { target: { value: '새 가구 입력' } });
  await act(async () => resolve());
  expect(screen.getByDisplayValue('새 가구 입력')).toBeInTheDocument();
});
