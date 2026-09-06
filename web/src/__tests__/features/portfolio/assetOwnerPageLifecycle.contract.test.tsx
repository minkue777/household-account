import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Asset } from '@/types/asset';
import type { AssetOwnerProfileView } from '@/features/access-household/domain/assetOwnerProfile';
import type { PreviousAssetDailySummary } from '@/features/portfolio/application/dailyAssetChangeSummary';

let mockHouseholdId = 'house-1';
const mockCommand = jest.fn();
const mockProfiles = jest.fn();
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ household: { id: mockHouseholdId, name: mockHouseholdId }, adminHouseholdView: null, isSessionVerified: true, remoteReadEpoch: 0 }) }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ themeConfig: { titleGradient: 'none' } }) }));
jest.mock('@/contexts/AppDialogContext', () => ({ useAppDialog: () => ({ showPrompt: jest.fn() }) }));
jest.mock('@/composition/webCommandRuntime', () => ({ getHouseholdCommandClient: () => ({ execute: mockCommand }) }));
jest.mock('@/composition/webQueryRuntime', () => ({ getHouseholdQueryClient: () => ({ execute: jest.fn() }) }));
jest.mock('@/composition/assetOwnerProfileReadRuntime', () => ({ getAssetOwnerProfileQueries: () => ({ subscribeActive: mockProfiles }) }));
jest.mock('@/composition/stockInstrumentCatalogRuntime', () => ({ warmStockInstrumentCatalog: jest.fn() }));
jest.mock('@/lib/assetService', () => ({ subscribeToAssets: jest.fn(), refreshAllMarketValues: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/platform/read-model/assetDailyChangeReadModel', () => ({ readPreviousAssetDailySummary: jest.fn() }));
jest.mock('@/lib/utils/useHouseholdHoldingSnapshots', () => ({ useHouseholdHoldingSnapshots: () => ({ stockHoldings: [], cryptoHoldings: [], stockHoldingsReady: true, cryptoHoldingsReady: true }) }));
jest.mock('@/components/assets/AssetList', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/assets/AssetAddModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/assets/AssetEditModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/assets/AssetHistoryModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/common/ModalOverlay', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import AssetsPage from '@/app/assets/page';
import { subscribeToAssets } from '@/lib/assetService';
import { readPreviousAssetDailySummary } from '@/platform/read-model/assetDailyChangeReadModel';
import { writeAssetOwnerProfileSnapshot, writeAssetSnapshot, writeDailyAssetChangeSnapshot } from '@/features/portfolio/application/portfolioReadSnapshot';
import { ALL_MEMBERS_OPTION } from '@/lib/assets/memberOptions';

const profile = (profileId: string, displayName: string, overrides: Partial<AssetOwnerProfileView> = {}): AssetOwnerProfileView => ({
  profileId, householdId: 'house-1', displayName, profileType: 'dependent', selectionVisibility: 'visible', lifecycleState: 'active', aggregateVersion: 1, ...overrides,
});
const profiles = [profile('p-a', '민규', { profileType: 'member' }), profile('p-hidden', '숨긴 명의', { selectionVisibility: 'hidden' }), profile('p-archived', '보관 명의', { lifecycleState: 'archived' })];
const dependent = profile('p-child', '지아');
const asset = (id: string, currentBalance: number, profileId?: string): Asset => ({
  id, aggregateVersion: 1, householdId: 'house-1', name: id, type: 'savings', ownerRef: profileId ? { kind: 'profile', profileId } : { kind: 'household' }, currentBalance, currency: 'KRW', isActive: true, order: 0, createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-06'),
});
const assets = [asset('a', 1000, 'p-a'), asset('child', 2000, 'p-child'), asset('joint', 300)];
let publishAssets: (assets: Asset[]) => void;
let publishProfiles: (profiles: AssetOwnerProfileView[]) => void;
let resolvePrevious: (value: PreviousAssetDailySummary | undefined) => void;

describe('[AST-009][T-AST-011] 실제 AssetsPage·명의자 command·일간 cache 연결', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-06T03:00:00Z'));
    window.localStorage.clear();
    mockHouseholdId = 'house-1';
    mockCommand.mockReset().mockResolvedValue(dependent);
    mockProfiles.mockReset().mockImplementation((_householdId: string, listener: typeof publishProfiles) => { publishProfiles = listener; return jest.fn(); });
    jest.mocked(subscribeToAssets).mockReset().mockImplementation((listener, _cache, source) => {
      publishAssets = next => { listener(next); source?.(next, { fromCache: false }); };
      return jest.fn();
    });
    jest.mocked(readPreviousAssetDailySummary).mockReset().mockImplementation(() => new Promise(resolve => { resolvePrevious = resolve; }));
  });
  afterEach(() => { cleanup(); jest.useRealTimers(); });

  it('dependent 추가는 실제 command를 호출하고 profileId 필터의 총액·변동을 함께 전환한다', async () => {
    render(<AssetsPage />);
    await act(async () => {
      publishAssets(assets); publishProfiles(profiles);
      resolvePrevious({ localDate: '2026-09-05', total: 3000, byOwnerRefKey: { 'profile:p-a': 900, 'profile:p-child': 1800, household: 300 } });
    });
    expect(screen.getByText(/3,300/)).toBeInTheDocument();
    expect(screen.getByText(/% \(300원\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '민규' }));
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
    expect(screen.getByText(/% \(100원\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '숨긴 명의' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '보관 명의' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '자산 명의자 추가' }));
    fireEvent.change(screen.getByPlaceholderText('이름'), { target: { value: '지아' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '추가' })); });
    expect(mockCommand).toHaveBeenCalledWith('access.create-asset-owner-profile.v1', { displayName: '지아' }, { householdId: 'house-1' });
    await act(async () => { publishProfiles([...profiles, dependent]); });
    expect(screen.queryByRole('button', { name: /삭제|보관/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    fireEvent.click(screen.getByRole('button', { name: '지아' }));
    expect(screen.getByText(/2,000/)).toBeInTheDocument();
    expect(screen.getByText(/% \(200원\)/)).toBeInTheDocument();
    expect(screen.queryByText(/% \(100원\)/)).not.toBeInTheDocument();
    expect(readPreviousAssetDailySummary).toHaveBeenCalledTimes(1);
  });

  it('같은 서울 날짜 재진입은 cache를 먼저 표시하고 다음 날짜·다른 가구 재진입은 이전 변동을 표시하지 않는다', async () => {
    writeAssetSnapshot('house-1', assets);
    writeAssetOwnerProfileSnapshot('house-1', [...profiles, dependent]);
    writeDailyAssetChangeSnapshot('house-1', { [ALL_MEMBERS_OPTION]: 321, 'p-a': 123, 'p-child': 198 });
    const first = render(<AssetsPage />);
    expect(screen.getByText(/% \(321원\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '보관 명의' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '민규' }));
    expect(screen.getByText(/% \(123원\)/)).toBeInTheDocument();
    first.unmount();
    const sameDate = render(<AssetsPage />);
    expect(screen.getByText(/% \(321원\)/)).toBeInTheDocument();
    await act(async () => {
      publishAssets(assets); publishProfiles([...profiles, dependent]);
      resolvePrevious({ localDate: '2026-09-05', total: 3000, byOwnerRefKey: { 'profile:p-a': 900, 'profile:p-child': 1800 } });
    });
    expect(screen.getByText(/% \(300원\)/)).toBeInTheDocument();
    expect(screen.queryByText(/% \(321원\)/)).not.toBeInTheDocument();
    sameDate.unmount();
    jest.setSystemTime(new Date('2026-09-06T15:00:01Z'));
    const nextDate = render(<AssetsPage />);
    expect(screen.getByText(/3,300/)).toBeInTheDocument();
    expect(screen.queryByText(/% \(/)).not.toBeInTheDocument();
    mockHouseholdId = 'house-2';
    nextDate.rerender(<AssetsPage />);
    expect(screen.queryByText(/3,300/)).not.toBeInTheDocument();
    expect(screen.queryByText(/% \(/)).not.toBeInTheDocument();
    expect(readPreviousAssetDailySummary).toHaveBeenLastCalledWith('house-2', '2026-09-07');
  });
});
