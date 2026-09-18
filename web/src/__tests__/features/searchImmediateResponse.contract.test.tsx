import { act, fireEvent, render, screen } from '@testing-library/react';
import SearchModal from '@/components/search/SearchModal';
import {
  searchExpenses,
  subscribeToExpenseProjection,
} from '@/lib/expenseService';

jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ householdKey: 'house-1', remoteReadEpoch: 0 }) }));

jest.mock('@/components/search/SearchResultList', () => function SearchResultListStub() {
  return <div data-testid="search-results" />;
});

jest.mock('@/lib/expenseService', () => ({
  createExpenseSearchMatcher: jest.fn(() => () => true),
  prepareExpenseSearchWindow: jest.fn(async () => {}),
  searchExpenses: jest.fn(async () => []),
  subscribeToExpenseProjection: jest.fn(() => ({
    publish: jest.fn(),
    dispose: jest.fn(),
  })),
}));

const mockedSearchExpenses = searchExpenses as jest.MockedFunction<typeof searchExpenses>;
const mockedSubscribeToExpenseProjection =
  subscribeToExpenseProjection as jest.MockedFunction<typeof subscribeToExpenseProjection>;

describe('원장 검색 첫 상호작용 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('[T-PERF-SEARCH-001][SEA-005] 검색어 입력 자체에 고정 대기 시간을 추가하지 않는다', async () => {
    render(
      <SearchModal
        isOpen
        onClose={jest.fn()}
        transactionType="expense"
      />
    );

    await act(async () => {
      fireEvent.change(
        screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색'),
        { target: { value: '삼성' } }
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedSubscribeToExpenseProjection).toHaveBeenCalledTimes(1);
    expect(mockedSearchExpenses).toHaveBeenCalledWith('삼성', {
      transactionType: 'expense', sourceWindow: expect.any(String),
    });
    expect(screen.queryByLabelText('검색 시작일')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('검색 종료일')).not.toBeInTheDocument();
  });
});
