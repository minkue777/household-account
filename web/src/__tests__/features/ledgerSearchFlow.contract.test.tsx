import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SearchModal from '@/components/search/SearchModal';
import { getDocsFromServer } from '@/platform/read-model/firestoreServerReadModel';
import { ledgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';

let mockHouseholdKey = 'house-1';
let mockRemoteReadEpoch = 0;
jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: () => ({ householdKey: mockHouseholdKey, remoteReadEpoch: mockRemoteReadEpoch }),
}));
jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: () => ({ householdId: mockHouseholdKey, memberId: 'member-1', principalUid: 'uid', sessionGeneration: mockRemoteReadEpoch + 1 }),
}));
jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({ getCategoryLabel: () => '식비', getCategoryColor: () => '#000000' }),
}));
jest.mock('@/components/expense', () => ({
  ExpenseEditModal: ({ onSave, onClose }: { onSave: (updates: { memo: string }) => Promise<void>; onClose: () => void }) => (
    <>
      <button onClick={() => void onSave({ memo: '변경한 메모' })}>수정 저장</button>
      <button onClick={onClose}>편집 닫기</button>
    </>
  ),
  ExpenseSplitModal: () => null,
}));
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  collection: jest.fn(), query: jest.fn(), where: jest.fn(), limit: jest.fn(),
  orderBy: jest.fn(), documentId: jest.fn(), getDocsFromServer: jest.fn(), db: {},
}));
jest.mock('@/platform/read-model/firestoreServerReadModel', () => ({
  collection: jest.fn(), query: jest.fn(), where: jest.fn(), limit: jest.fn(),
  orderBy: jest.fn(), documentId: jest.fn(), startAfter: jest.fn(),
  getDocsFromServer: jest.fn(), db: {},
}));

const mockedGetDocs = getDocsFromServer as jest.MockedFunction<typeof getDocsFromServer>;
const expenseSnapshot = (merchant = '검색 확인 가게', date = '2026-09-09') => ({ docs: [{
  id: 'row-1',
  data: () => ({
    householdId: 'house-1', transactionType: 'expense', accountingDate: date,
    merchant, memo: '저녁 식사', amountInWon: 12000,
    categoryId: 'food', cardType: 'manual', aggregateVersion: 1, lifecycleState: 'active',
  }),
}] } as Awaited<ReturnType<typeof getDocsFromServer>>);

describe('메인 검색 입력부터 실제 결과 표시까지', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDocs.mockReset();
    mockHouseholdKey = 'house-1';
    mockRemoteReadEpoch = 0;
    ledgerOptimisticProjection.reset();
  });

  test('닫힌 검색은 조회하지 않고 열린 순간부터 입력과 동일한 서버 원본을 준비한다', async () => {
    let resolveSource!: (snapshot: Awaited<ReturnType<typeof getDocsFromServer>>) => void;
    mockedGetDocs.mockImplementationOnce(() => new Promise(resolve => { resolveSource = resolve; }));
    const { rerender } = render(<SearchModal isOpen={false} onClose={jest.fn()} transactionType="expense" />);
    await act(async () => { await Promise.resolve(); });
    expect(mockedGetDocs).not.toHaveBeenCalled();
    rerender(<SearchModal isOpen onClose={jest.fn()} transactionType="expense" />);
    await waitFor(() => expect(mockedGetDocs).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/검색 결과가 없습니다/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색'), { target: { value: '검색 확인' } });
    await act(async () => { resolveSource(expenseSnapshot()); });
    expect(await screen.findByText('검색 확인 가게')).toBeInTheDocument();
    expect(screen.getByText('1건 · 12,000원')).toBeInTheDocument();
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
  });

  test('가맹점과 메모 검색은 같은 서버 원본을 재사용하며 일치한 거래를 표시한다', async () => {
    mockedGetDocs.mockResolvedValue(expenseSnapshot());
    render(<SearchModal isOpen onClose={jest.fn()} transactionType="expense" />);
    const input = screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색');
    fireEvent.change(input, { target: { value: '검색 확인' } });
    expect(await screen.findByText('검색 확인 가게')).toBeInTheDocument();
    expect(screen.getByText('1건 · 12,000원')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '저녁' } });
    expect(await screen.findByText('검색 확인 가게')).toBeInTheDocument();
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
  });

  test('50건을 넘는 검색도 과거 월을 바로 펼치고 수정 재조회 동안 월과 스크롤을 유지한다', async () => {
    const baseData = expenseSnapshot().docs[0].data() as Record<string, unknown>;
    const documents = Array.from({ length: 55 }, (_, index) => ({
      id: `new-${index}`, data: () => ({ ...baseData, merchant: `검색 확인 ${index}` }),
    }));
    const older = { id: 'older', data: () => ({ ...baseData, accountingDate: '2020-01-01', merchant: '검색 확인 과거' }) };
    const initial = { docs: [...documents, older] } as Awaited<ReturnType<typeof getDocsFromServer>>;
    mockedGetDocs.mockResolvedValueOnce(initial);
    let resolveRefresh!: (value: typeof initial) => void;
    mockedGetDocs.mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    render(<SearchModal isOpen onClose={jest.fn()} transactionType="expense" onExpenseUpdate={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색'), { target: { value: '검색 확인' } });
    const month = await screen.findByRole('button', { name: /2020년 1월/ });
    fireEvent.click(month);
    expect(screen.getByText('검색 확인 과거')).toBeInTheDocument();
    expect(screen.queryByText('검색 확인 0')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이전 거래에서 더 검색' })).not.toBeInTheDocument();
    const scroller = month.closest('[aria-busy]') as HTMLElement;
    scroller.scrollTop = 420;
    fireEvent.click(screen.getByText('검색 확인 과거'));
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
    await waitFor(() => expect(mockedGetDocs).toHaveBeenCalledTimes(2));
    expect(scroller).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('검색 확인 과거')).toBeInTheDocument();
    await act(async () => { resolveRefresh({ docs: [...documents, { ...older, data: () => ({ ...older.data(), memo: '변경한 메모', aggregateVersion: 2 }) }] } as typeof initial); });
    expect(month).toHaveAttribute('aria-expanded', 'true');
    expect(scroller.scrollTop).toBe(420);
    expect(scroller).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText(/변경한 메모/)).toBeInTheDocument();
    expect(screen.getByText('56건 · 672,000원')).toBeInTheDocument();
  });

  test('조회 실패는 간단히 안내하고 검색어 입력으로 다시 조회한다', async () => {
    mockedGetDocs.mockRejectedValueOnce(Object.assign(new Error('private provider details'), { code: 'invalid-argument' }));
    mockedGetDocs.mockResolvedValue(expenseSnapshot());
    render(<SearchModal isOpen onClose={jest.fn()} transactionType="expense" />);
    const input = screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색');
    fireEvent.change(input, {
      target: { value: '검색 확인' },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/^검색 결과를 불러오지 못했습니다\.$/);
    expect(screen.queryByText(/검색 결과가 없습니다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/invalid-argument|private provider details/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '저녁' } });
    expect(await screen.findByText('검색 확인 가게')).toBeInTheDocument();
    expect(screen.getByText('1건 · 12,000원')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedGetDocs).toHaveBeenCalledTimes(2);
  });

  test('수정 후 자동 재조회가 실패해도 기존 결과를 유지하고 새 검색어 입력으로 조회한다', async () => {
    mockedGetDocs.mockResolvedValueOnce(expenseSnapshot());
    mockedGetDocs.mockRejectedValueOnce(new Error('network unavailable'));
    mockedGetDocs.mockResolvedValue(expenseSnapshot('검색 확인 새 가게', '2026-08-09'));
    render(<SearchModal isOpen onClose={jest.fn()} transactionType="expense" onExpenseUpdate={jest.fn()} />);
    const input = screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색');
    fireEvent.change(input, {
      target: { value: '검색 확인' },
    });
    fireEvent.click(await screen.findByText('검색 확인 가게'));
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('검색 결과를 불러오지 못했습니다.');
    expect(screen.getByText('검색 확인 가게')).toBeInTheDocument();
    expect(screen.getByText('1건 · 12,000원')).toBeInTheDocument();
    expect(screen.queryByText(/검색 결과가 없습니다/)).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '검색 확인 새' } });
    expect(await screen.findByText('검색 확인 새 가게')).toBeInTheDocument();
    expect(screen.queryByText('검색 확인 가게')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedGetDocs).toHaveBeenCalledTimes(3);
  });

  test('다시 조회하는 동안 검색어를 바꾸면 이전 요청이 현재 결과를 덮어쓰지 않는다', async () => {
    let resolveSearch!: (snapshot: Awaited<ReturnType<typeof getDocsFromServer>>) => void;
    mockedGetDocs.mockRejectedValueOnce(new Error('network unavailable'));
    mockedGetDocs.mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve; }));
    render(<SearchModal isOpen onClose={jest.fn()} transactionType="expense" />);
    const input = screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색');
    fireEvent.change(input, { target: { value: '검색 확인' } });
    await screen.findByRole('alert');
    fireEvent.change(input, { target: { value: '다른 가게' } });
    await waitFor(() => expect(mockedGetDocs).toHaveBeenCalledTimes(2));
    fireEvent.change(input, { target: { value: '점심' } });
    await act(async () => { resolveSearch(expenseSnapshot('점심 가게')); });

    expect(await screen.findByText('점심 가게')).toBeInTheDocument();
    expect(screen.getByText('"점심" 검색 결과')).toBeInTheDocument();
    expect(screen.queryByText(/검색 결과가 없습니다/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('검색어를 바꾼 뒤 조회가 실패하면 이전 검색어의 결과를 표시하지 않는다', async () => {
    mockedGetDocs.mockResolvedValueOnce(expenseSnapshot());
    mockedGetDocs.mockRejectedValueOnce(new Error('network unavailable'));
    mockedGetDocs.mockRejectedValueOnce(new Error('network unavailable'));
    render(<SearchModal isOpen onClose={jest.fn()} transactionType="expense" onExpenseUpdate={jest.fn()} />);
    const input = screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색');
    fireEvent.change(input, { target: { value: '검색 확인' } });
    fireEvent.click(await screen.findByText('검색 확인 가게'));
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
    await screen.findByRole('alert');
    fireEvent.change(input, { target: { value: '다른 가게' } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('검색 확인 가게')).not.toBeInTheDocument();
    expect(screen.queryByText(/검색 결과가 없습니다/)).not.toBeInTheDocument();
  });

  test.each(['다른 가게', '변경한 메모', ''])('저장 중 검색어를 "%s"로 바꿔도 현재 검색을 유지하며 저장한 새 메모를 검색한다', async (pendingKeyword) => {
    const first = expenseSnapshot('검색 확인 가게').docs[0];
    const second = { ...expenseSnapshot('다른 가게').docs[0], id: 'row-2' };
    let savedSource = { docs: [first, second] } as Awaited<ReturnType<typeof getDocsFromServer>>;
    mockedGetDocs.mockImplementation(async () => savedSource);
    let finishSave!: () => void;
    const onExpenseUpdate = jest.fn(async (_id: string, updates: { memo?: string }) => {
      await new Promise<void>(resolve => { finishSave = resolve; });
      savedSource = { docs: [
        { ...first, data: () => ({ ...first.data() as Record<string, unknown>, ...updates, aggregateVersion: 2 }) },
        second,
      ] } as typeof savedSource;
    });
    render(<SearchModal isOpen onClose={jest.fn()} transactionType="expense" onExpenseUpdate={onExpenseUpdate} />);
    const input = screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색');
    fireEvent.change(input, { target: { value: '검색 확인' } });
    fireEvent.click(await screen.findByText('검색 확인 가게'));
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
    expect(onExpenseUpdate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '편집 닫기' }));
    fireEvent.change(input, { target: { value: pendingKeyword } });
    if (pendingKeyword === '다른 가게') {
      expect(await screen.findByText('다른 가게')).toBeInTheDocument();
    } else if (pendingKeyword) {
      expect(await screen.findByText(/검색 결과가 없습니다/)).toBeInTheDocument();
    }

    await act(async () => { finishSave(); });

    expect(input).toHaveValue(pendingKeyword);
    if (pendingKeyword === '다른 가게') {
      expect(screen.getByText('다른 가게')).toBeInTheDocument();
      expect(screen.queryByText('검색 확인 가게')).not.toBeInTheDocument();
    }
    fireEvent.change(input, { target: { value: '변경한 메모' } });
    expect(await screen.findByText('"변경한 메모" 검색 결과')).toBeInTheDocument();
    const month = screen.getByRole('button', { name: /2026년 9월/ });
    if (month.getAttribute('aria-expanded') === 'false') fireEvent.click(month);
    expect(screen.getByText('검색 확인 가게')).toBeInTheDocument();
    expect(screen.getByText(/2026-09-09 · 변경한 메모/)).toBeInTheDocument();
    expect(screen.queryByText('다른 가게')).not.toBeInTheDocument();
    expect(screen.queryByText(/검색 결과가 없습니다/)).not.toBeInTheDocument();
  });

  test('저장 후 재조회 중 검색어를 바꿔도 새 메모 검색 결과만 표시한다', async () => {
    const first = expenseSnapshot().docs[0];
    let savedSource = expenseSnapshot();
    mockedGetDocs.mockResolvedValueOnce(savedSource);
    let finishRefresh!: (snapshot: typeof savedSource) => void;
    mockedGetDocs.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
    const onExpenseUpdate = jest.fn(async (_id: string, updates: { memo?: string }) => {
      savedSource = { docs: [{ ...first, data: () => ({ ...first.data() as Record<string, unknown>, ...updates, aggregateVersion: 2 }) }] } as typeof savedSource;
    });
    render(<SearchModal isOpen onClose={jest.fn()} transactionType="expense" onExpenseUpdate={onExpenseUpdate} />);
    const input = screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색');
    fireEvent.change(input, { target: { value: '검색 확인' } });
    fireEvent.click(await screen.findByText('검색 확인 가게'));
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
    await waitFor(() => expect(mockedGetDocs).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '편집 닫기' }));
    fireEvent.change(input, { target: { value: '변경한 메모' } });
    await act(async () => { finishRefresh(savedSource); });

    expect(await screen.findByText('"변경한 메모" 검색 결과')).toBeInTheDocument();
    expect(screen.getByText('검색 확인 가게')).toBeInTheDocument();
    expect(screen.getByText(/2026-09-09 · 변경한 메모/)).toBeInTheDocument();
    expect(screen.queryByText('"검색 확인" 검색 결과')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test.each(['닫기', '재열기', '가구 전환', '세션 갱신', '언마운트'])('저장 중 %s 이후 도착한 완료는 종료된 검색 세션이나 새 세션을 갱신하지 않는다', async (transition) => {
    mockedGetDocs.mockResolvedValue(expenseSnapshot());
    let finishSave!: () => void;
    const onExpenseUpdate = jest.fn(() => new Promise<void>(resolve => { finishSave = resolve; }));
    const props = { onClose: jest.fn(), transactionType: 'expense' as const, onExpenseUpdate };
    const { rerender, unmount } = render(<SearchModal {...props} isOpen />);
    fireEvent.change(screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색'), { target: { value: '검색 확인' } });
    fireEvent.click(await screen.findByText('검색 확인 가게'));
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));

    if (transition === '언마운트') {
      unmount();
    } else if (transition === '닫기' || transition === '재열기') {
      rerender(<SearchModal {...props} isOpen={false} />);
      if (transition === '재열기') rerender(<SearchModal {...props} isOpen />);
    } else {
      if (transition === '가구 전환') mockHouseholdKey = 'house-2';
      mockRemoteReadEpoch += 1;
      rerender(<SearchModal {...props} isOpen />);
    }
    const staysClosed = transition === '닫기' || transition === '언마운트';
    if (!staysClosed) {
      fireEvent.change(screen.getByPlaceholderText('지출처명, 메모, 카드명, 태그 검색'), { target: { value: '새 세션 검색어' } });
      await screen.findByText('"새 세션 검색어"에 대한 검색 결과가 없습니다.');
    }
    const readsBeforeCompletion = mockedGetDocs.mock.calls.length;
    await act(async () => { finishSave(); });

    expect(mockedGetDocs).toHaveBeenCalledTimes(readsBeforeCompletion);
    expect(screen.queryByText('검색 확인 가게')).not.toBeInTheDocument();
    if (staysClosed) {
      expect(screen.queryByPlaceholderText('지출처명, 메모, 카드명, 태그 검색')).not.toBeInTheDocument();
    } else {
      expect(screen.getByText('"새 세션 검색어"에 대한 검색 결과가 없습니다.')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  });
});
