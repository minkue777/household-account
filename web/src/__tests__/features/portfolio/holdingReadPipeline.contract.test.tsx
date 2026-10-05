const mockOnSnapshot = jest.fn();

jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: { kind: 'db' },
  collection: jest.fn((...segments: unknown[]) => ({ kind: 'collection', segments })),
  collectionGroup: jest.fn((...segments: unknown[]) => ({ kind: 'collectionGroup', segments })),
  doc: jest.fn((...segments: unknown[]) => ({ kind: 'document', segments })),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn((...constraints: unknown[]) => ({ kind: 'query', constraints })),
  where: jest.fn((...args: unknown[]) => ({ kind: 'where', args })),
  orderBy: jest.fn((...args: unknown[]) => ({ kind: 'orderBy', args })),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  timestampToDate: (value: unknown) => value instanceof Date ? value : undefined,
}));


jest.mock('@/features/portfolio/application/portfolioCommands', () => ({ portfolioCommands: {} }));
jest.mock('@/features/portfolio/application/portfolioQueries', () => ({ portfolioQueries: {
  searchStocks: jest.fn(), getStockQuote: jest.fn(), searchCrypto: jest.fn(), getCryptoQuote: jest.fn(),
} }));
jest.mock('@/contexts/AppDialogContext', () => ({ useAppDialog: () => ({ showAlert: jest.fn() }) }));
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AssetHistoryModal from '@/components/assets/AssetHistoryModal';
import { useHouseholdHoldingSnapshots, resetHouseholdHoldingSnapshotsForTests } from '@/lib/utils/useHouseholdHoldingSnapshots';
import { setClientSessionScope } from '@/composition/clientSessionScope';
import { resetClientOptimisticProjections } from '@/composition/resetClientOptimisticProjections';
import type { Asset } from '@/types/asset';
const asset: Asset = { id: 'account', aggregateVersion: 1, householdId: 'house-1', name: '계좌', type: 'stock', currentBalance: 10000,
  currency: 'KRW', isActive: true, order: 0, createdAt: new Date(), updatedAt: new Date() };
function Screen() {
  const [epoch, setEpoch] = useState(0);
  const snapshots = useHouseholdHoldingSnapshots('house-1', true, epoch);
  return <AssetHistoryModal isOpen onClose={jest.fn()} onEditAsset={jest.fn()} asset={asset} onRetryHoldings={() => setEpoch(value => value + 1)} {...snapshots} />;
}
test('실제 서비스 → snapshot hook → 상세 화면에서 SDK 실패와 정상 빈 결과를 구분한다', () => {
  resetClientOptimisticProjections();
  resetHouseholdHoldingSnapshotsForTests();
  setClientSessionScope({ principalUid: 'uid', householdId: 'house-1', memberId: 'member', sessionGeneration: 1 });
  mockOnSnapshot.mockImplementation(() => jest.fn());
  const view = render(<Screen />);
  expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
  const stockListener = mockOnSnapshot.mock.calls[0];
  act(() => stockListener[3](new Error('unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent('보유 내역을 불러오지 못했습니다.');
  expect(screen.queryByText(/보유 항목이 없습니다/)).not.toBeInTheDocument();
  expect(screen.getByText(/평가금액 확인 불가/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  act(() => mockOnSnapshot.mock.calls[2][2]({ docs: [], metadata: { fromCache: false } }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('보유 항목이 없습니다.')).toBeInTheDocument();
  expect(screen.getByText(/평가금액 0원/)).toBeInTheDocument();
  view.unmount();
  expect(mockOnSnapshot.mock.results.every(result => result.value.mock.calls.length === 1)).toBe(true);
});
