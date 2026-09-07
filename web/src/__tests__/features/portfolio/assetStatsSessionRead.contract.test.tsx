import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Profiler } from 'react';
import AssetStatsPage from '@/app/assets/stats/page';
import { readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import { subscribeToAssets, getAllStockHoldings, getDividendSnapshot, getDividendEventsByYear } from '@/lib/assetService';
import type { AssetHistoryEntry } from '@/types/asset';
import { getTodayLocalDate } from '@/lib/utils/date';

let mockScope = { householdKey: 'house-1', isSessionVerified: false, remoteReadEpoch: 0 };
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => mockScope }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ themeConfig: { titleGradient: 'linear-gradient(blue, purple)' } }) }));
jest.mock('@/lib/assetService', () => ({
  subscribeToAssets: jest.fn(() => () => {}),
  getAllStockHoldings: jest.fn(async () => []),
  getDividendSnapshot: jest.fn(async () => null),
  getDividendEventsByYear: jest.fn(async () => []),
}));
jest.mock('@/platform/reporting/assetStatisticsReadModel', () => ({ readAssetStatisticsHistory: jest.fn() }));
jest.mock('react-chartjs-2', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Line: React.forwardRef(function MockLine({ data }: { data: unknown }, _ref) {
      return <output data-testid="chart">{JSON.stringify(data)}</output>;
    }),
    Bar: ({ data }: { data: unknown }) => <output data-testid="bar-chart">{JSON.stringify(data)}</output>,
  };
});
const read = jest.mocked(readAssetStatisticsHistory);
function entry(assetId: string, date: string, balance: number, extra = {}): AssetHistoryEntry { return { id: assetId + date, householdId: 'house-1', assetId, date, balance, changeAmount: 0, createdAt: new Date(), ...extra }; }
describe('actual asset statistics page', () => {
  beforeEach(() => { jest.clearAllMocks(); mockScope = { householdKey: 'house-1', isSessionVerified: false, remoteReadEpoch: 0 }; read.mockResolvedValue([]); });
  it('waits for restored session, reads again on household change and discards old replies', async () => {
    let oldResolve!: (rows: AssetHistoryEntry[]) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve; }));
    const { rerender } = render(<AssetStatsPage />);
    expect(read).not.toHaveBeenCalled();
    mockScope.isSessionVerified = true; rerender(<AssetStatsPage />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    mockScope = { ...mockScope, householdKey: 'house-2' }; rerender(<AssetStatsPage />);
    await screen.findByText('데이터가 없습니다');
    await act(async () => oldResolve([entry('TOTAL', '2026-08-01', 123456)]));
    expect(screen.queryByText('123,456')).not.toBeInTheDocument();
  });
  it.each(['household', 'remote epoch'] as const)('hides a completed source in the first %s-change commit before passive effects clear it', async change => {
    mockScope.isSessionVerified = true;
    read.mockResolvedValueOnce([entry('TOTAL', getTodayLocalDate(), 987654)]);
    const commits: string[] = [];
    const page = () => (
      <Profiler id="asset-stats" onRender={() => { commits.push(document.body.textContent ?? ''); }}>
        <AssetStatsPage />
      </Profiler>
    );
    const { rerender } = render(page());
    await screen.findByText('987,654');
    commits.length = 0;
    read.mockImplementationOnce(() => new Promise<AssetHistoryEntry[]>(() => {}));
    mockScope = change === 'household'
      ? { ...mockScope, householdKey: 'house-2' }
      : { ...mockScope, remoteReadEpoch: mockScope.remoteReadEpoch + 1 };
    rerender(page());
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]).toContain('불러오는 중...');
    for (const committedText of commits) {
      expect(committedText).not.toContain('987,654');
      expect(committedText).not.toContain('987654');
      expect(committedText).not.toContain('자산 변동 차트');
      expect(committedText).not.toContain('배당금 현황');
    }
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('does not expose an earlier household failure in the first commit of a new pending source', async () => {
    mockScope.isSessionVerified = true;
    read.mockRejectedValueOnce(new Error('previous household unavailable'));
    const commits: string[] = [];
    const page = () => (
      <Profiler id="asset-stats-error" onRender={() => { commits.push(document.body.textContent ?? ''); }}>
        <AssetStatsPage />
      </Profiler>
    );
    const { rerender } = render(page());
    await screen.findByRole('alert');
    commits.length = 0;
    read.mockImplementationOnce(() => new Promise<AssetHistoryEntry[]>(() => {}));
    mockScope = { ...mockScope, householdKey: 'house-2' };
    rerender(page());
    expect(commits[0]).toContain('불러오는 중...');
    expect(commits.every(text => !text.includes('자산 통계를 불러오지 못했습니다.'))).toBe(true);
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
  });
  it('shows only asset-type series, preserves observed zero and reads ALL without a 2020 cutoff', async () => {
    mockScope.isSessionVerified = true;
    read.mockResolvedValue([entry('TOTAL', '2019-01-01', 0), entry('TYPE_stock', '2019-01-01', 0), entry('OWNER_REF_profile:old', '2019-01-01', 0, { ownerKey: 'profile:old', ownerDisplayName: '지아' })]);
    render(<AssetStatsPage />);
    await screen.findByText('마지막 기록 자산');
    expect(read).toHaveBeenCalledWith(undefined, expect.any(String));
    expect(screen.queryByText('데이터가 없습니다')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '지아' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('소유자별 자산 추이')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '주식' }));
    expect(screen.getByRole('button', { name: '전체 자산' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '주식' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(screen.getByTestId('chart').textContent!).datasets.map((dataset: { label: string }) => dataset.label)).toEqual(['전체', '주식']);
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }));
    expect(screen.getByTestId('chart').textContent).toContain('1/1');
    fireEvent.click(screen.getByRole('button', { name: '6개월' }));
    expect(screen.getByRole('button', { name: '주식' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '지아' })).not.toBeInTheDocument();
    expect(screen.getByTestId('chart').textContent).not.toContain('지아');
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('switches periods locally without loading, repeated child reads, or lost chart selections', async () => {
    mockScope.isSessionVerified = true;
    const today = getTodayLocalDate();
    read.mockResolvedValue([
      entry('TOTAL', '2019-01-01', 80),
      entry('TOTAL', today, 100, { changeAmount: 20 }),
    ]);
    render(<AssetStatsPage />);
    await screen.findByText('마지막 기록 자산');
    await waitFor(() => expect(getDividendSnapshot).toHaveBeenCalledTimes(1));
    expect(JSON.parse(screen.getByTestId('chart').textContent!).datasets[0].data).toEqual([80, 100]);

    fireEvent.click(screen.getByRole('button', { name: '월별', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '월별 자산 변동' }));
    const profitToggle = screen.getByRole('button', { name: '월별 자산 변동' });
    expect(profitToggle).toHaveAttribute('aria-expanded', 'true');
    const dividendCard = screen.getByText('배당금 현황').closest('.rounded-2xl') as HTMLElement;
    fireEvent.click(within(dividendCard).getAllByRole('button')[0]);
    await waitFor(() => expect(getDividendSnapshot).toHaveBeenCalledTimes(2));
    const selectedDividendYear = jest.mocked(getDividendSnapshot).mock.calls.at(-1)![0];
    const readsBefore = [read, subscribeToAssets, getAllStockHoldings, getDividendSnapshot, getDividendEventsByYear]
      .map(source => jest.mocked(source).mock.calls.length);

    // A confirmed current total also remains visible during all local changes.
    act(() => jest.mocked(subscribeToAssets).mock.calls.at(-1)![2]!([], { fromCache: false }));
    for (const period of ['전체 기간', '6개월', '1년', '3개월']) {
      fireEvent.click(screen.getByRole('button', { name: period }));
      expect(screen.queryByText('불러오는 중...')).not.toBeInTheDocument();
      expect(screen.getByText('현재 총 자산')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '월별 자산 변동' })).toBe(profitToggle);
      expect(profitToggle).toHaveAttribute('aria-expanded', 'true');
      expect(within(dividendCard).getByText(`${selectedDividendYear}년`)).toBeInTheDocument();
      expect([read, subscribeToAssets, getAllStockHoldings, getDividendSnapshot, getDividendEventsByYear]
        .map(source => jest.mocked(source).mock.calls.length)).toEqual(readsBefore);
    }
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }));
    expect(screen.getByTestId('chart').textContent).toContain('1/1');
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('refreshes the complete source for an explicit remote-read revision', async () => {
    mockScope.isSessionVerified = true;
    read.mockResolvedValueOnce([entry('TOTAL', '2019-01-01', 10)]);
    const { rerender } = render(<AssetStatsPage />);
    await screen.findByText('10');
    read.mockResolvedValueOnce([entry('TOTAL', getTodayLocalDate(), 25)]);
    mockScope = { ...mockScope, remoteReadEpoch: 1 };
    rerender(<AssetStatsPage />);
    await screen.findByText('25');
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(undefined, expect.any(String));
  });
  it('does not replace history with a cached empty list and accepts a confirmed zero balance', async () => {
    mockScope.isSessionVerified = true;
    read.mockResolvedValue([entry('TOTAL', '2026-09-01', 123456)]);
    render(<AssetStatsPage />);
    await screen.findByText('123,456');
    const onSourceSnapshot = jest.mocked(subscribeToAssets).mock.calls.at(-1)![2]!;
    act(() => onSourceSnapshot([], { fromCache: true }));
    expect(screen.getByText('123,456')).toBeInTheDocument();
    act(() => onSourceSnapshot([], { fromCache: false }));
    expect(screen.getByText('현재 총 자산')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('123,456')).not.toBeInTheDocument();
  });
  it('failure stays distinct from NoData and zero and supports retry', async () => {
    mockScope.isSessionVerified = true; read.mockRejectedValueOnce(new Error('offline'));
    render(<AssetStatsPage />);
    await screen.findByRole('alert');
    expect(screen.queryByText('0원')).not.toBeInTheDocument();
    expect(screen.queryByText('데이터가 없습니다')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByText('데이터가 없습니다');
  });
});
