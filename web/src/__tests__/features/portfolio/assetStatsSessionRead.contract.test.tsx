import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AssetStatsPage from '@/app/assets/stats/page';
import { readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import { subscribeToAssets } from '@/lib/assetService';
import type { AssetHistoryEntry } from '@/types/asset';

let mockScope = { householdKey: 'house-1', isSessionVerified: false, remoteReadEpoch: 0 };
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => mockScope }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ themeConfig: { titleGradient: 'linear-gradient(blue, purple)' } }) }));
jest.mock('@/lib/assetService', () => ({ subscribeToAssets: jest.fn(() => () => {}) }));
jest.mock('@/platform/reporting/assetStatisticsReadModel', () => ({ readAssetStatisticsHistory: jest.fn() }));
jest.mock('@/components/assets/AssetProfitChart', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/assets/AssetDividendChart', () => ({ __esModule: true, default: () => null }));
jest.mock('react-chartjs-2', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Line: React.forwardRef(function MockLine({ data }: { data: unknown }, _ref) {
      return <output data-testid="chart">{JSON.stringify(data)}</output>;
    }),
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
  it('restores simultaneous type series, preserves observed zero and reads ALL without a 2020 cutoff', async () => {
    mockScope.isSessionVerified = true;
    read.mockResolvedValue([entry('TOTAL', '2019-01-01', 0), entry('TYPE_stock', '2019-01-01', 0), entry('OWNER_REF_profile:old', '2019-01-01', 0, { ownerKey: 'profile:old', ownerDisplayName: '지아' })]);
    render(<AssetStatsPage />);
    await screen.findByText('마지막 기록 자산');
    expect(screen.queryByText('데이터가 없습니다')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '주식' }));
    expect(screen.getByRole('button', { name: '전체 자산' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '주식' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(screen.getByTestId('chart').textContent!).datasets.map((dataset: { label: string }) => dataset.label)).toEqual(['전체', '주식']);
    fireEvent.click(screen.getByRole('button', { name: '지아' }));
    expect(screen.getByRole('button', { name: '지아' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(screen.getByTestId('chart').textContent!).datasets.map((dataset: { label: string }) => dataset.label)).toEqual(['전체', '주식', '지아']);
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }));
    await waitFor(() => expect(read).toHaveBeenLastCalledWith(undefined, expect.any(String)));
    await waitFor(() => expect(screen.getByTestId('chart').textContent).toContain('1/1'));
    read.mockResolvedValueOnce([entry('TOTAL', '2026-09-01', 10)]);
    fireEvent.click(screen.getByRole('button', { name: '6개월' }));
    await screen.findByText('자산 추이');
    expect(screen.queryByRole('button', { name: '주식' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '지아' })).not.toBeInTheDocument();
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
