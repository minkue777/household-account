import { act, render, screen, waitFor } from '@testing-library/react';
import { CategoryProvider, useCategoryContext } from '@/contexts/CategoryContext';
import { setClientSessionScope } from '@/composition/clientSessionScope';
import { categoryCommands } from '@/features/category-budget/application/categoryCommands';

const mockWatch = jest.fn();
const mockRead = jest.fn();
const mockExecute = jest.fn();
let mockHouseholdId = 'house-1';
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ householdKey: mockHouseholdId }) }));
jest.mock('@/composition/webCommandRuntime', () => ({ getHouseholdCommandClient: () => ({ execute: mockExecute }) }));
jest.mock('@/platform/read-model/initialHomeRead', () => ({ subscribeWithInitialHomeRead: ({ listen }: { listen: () => () => void }) => listen() }));
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: {}, doc: (...path: unknown[]) => path, onDocumentSnapshot: (...args: unknown[]) => mockWatch(...args),
}));
jest.mock('@/platform/read-model/firestoreServerReadModel', () => ({
  db: {}, doc: (...path: unknown[]) => path, getDocFromServer: (...args: unknown[]) => mockRead(...args),
}));

function catalog(version: number, name = '식비') {
  return { schemaVersion: 1, householdId: mockHouseholdId, catalogVersion: version, defaultCategoryId: 'food',
    categories: [{ categoryId: 'food', name, color: '#123456', budgetInWon: null, sortOrder: 0, version: 2, state: 'active' }] };
}
function snapshot(data: unknown, fromCache = false) { return { metadata: { fromCache }, data: () => data }; }
function Consumer({ name }: { name: string }) {
  const value = useCategoryContext();
  return <output aria-label={name}>{JSON.stringify({ labels: value.activeCategories.map(category => category.label),
    version: value.catalogVersion, default: value.defaultCategoryKey, ready: value.serverSnapshotReady, failed: value.readError != null })}</output>;
}

beforeEach(() => {
  jest.clearAllMocks(); mockRead.mockReset(); mockExecute.mockReset();
  mockHouseholdId = 'house-1';
  setClientSessionScope({ sessionGeneration: 1, householdId: mockHouseholdId, principalUid: 'uid', memberId: 'member', accessMode: 'member' });
  mockWatch.mockReturnValue(jest.fn());
});

it('목록과 설정 소비자가 같은 한 구독의 목록·기본값·버전을 받고 가구 교체 후 이전 callback을 무시한다', async () => {
  const { rerender } = render(<CategoryProvider><Consumer name="목록" /><Consumer name="설정" /></CategoryProvider>);
  await waitFor(() => expect(mockWatch).toHaveBeenCalledTimes(1));
  const [, , next, error] = mockWatch.mock.calls[0];
  act(() => next(snapshot(catalog(7), true)));
  expect(screen.getByLabelText('목록')).toHaveTextContent('"ready":false');
  act(() => next(snapshot(catalog(8))));
  expect(screen.getByLabelText('목록').textContent).toBe(screen.getByLabelText('설정').textContent);
  expect(screen.getByLabelText('설정')).toHaveTextContent('"version":8,"default":"food","ready":true');
  const oldData = catalog(9, '이전 가구');
  mockHouseholdId = 'house-2';
  setClientSessionScope({ sessionGeneration: 2, householdId: mockHouseholdId, principalUid: 'uid-2', memberId: 'member-2', accessMode: 'member' });
  rerender(<CategoryProvider><Consumer name="목록" /><Consumer name="설정" /></CategoryProvider>);
  await waitFor(() => expect(mockWatch).toHaveBeenCalledTimes(2));
  act(() => { next(snapshot(oldData)); error(new Error('late')); });
  expect(screen.getByLabelText('설정')).toHaveTextContent('"labels":[],"version":null');
  expect(screen.getByLabelText('설정')).toHaveTextContent('"failed":false');
  act(() => mockWatch.mock.calls[1][2](snapshot(catalog(1, '새 가구'))));
  expect(screen.getByLabelText('목록')).toHaveTextContent('새 가구');
  act(() => mockWatch.mock.calls[1][3](new Error('denied')));
  expect(screen.getByLabelText('설정')).toHaveTextContent('"ready":false,"failed":true');
});

it('삭제는 준비 횟수와 무관하게 확정 응답 버전을 반환하고 추가 조회하지 않는다', async () => {
  mockExecute.mockResolvedValue({ catalogVersion: 12 });
  expect(await categoryCommands.archive('house-1', 'food', 3)).toBe(12);
  expect(mockExecute).toHaveBeenCalledWith('category.archive.v1', { categoryId: 'food', expectedVersion: 3 }, { householdId: 'house-1' });
  expect(mockRead).not.toHaveBeenCalled();
});

it('구 receipt 응답만 서버의 실제 카탈로그 버전을 조회하며 실패를 임의 버전으로 바꾸지 않는다', async () => {
  mockExecute.mockResolvedValue({});
  mockRead.mockResolvedValue(snapshot(catalog(19)));
  expect(await categoryCommands.reorder('house-1', [{ id: 'food', order: 0 }], 7)).toBe(19);
  expect(mockRead).toHaveBeenCalledTimes(1);
  mockRead.mockRejectedValue(new Error('offline'));
  await expect(categoryCommands.setDefault('house-1', 'food', 19)).rejects.toThrow('offline');
});
