import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockSessionVerified = false;
let mockAdminHouseholdView: { householdId: string; householdName: string } | null = null;

jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: () => ({
    isSessionVerified: mockSessionVerified,
    adminHouseholdView: mockAdminHouseholdView,
  }),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    themeConfig: { titleGradient: 'linear-gradient(#000, #000)' },
  }),
}));

jest.mock('@/components/assets/AssetProfitChart', () => ({
  __esModule: true,
  default: () => <div data-testid={'asset-profit-chart'} />,
}));

jest.mock('@/components/assets/AssetDividendChart', () => ({
  __esModule: true,
  default: () => <div data-testid={'asset-dividend-chart'} />,
}));

jest.mock('react-chartjs-2', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Line: React.forwardRef(() => <div data-testid={'asset-trend-chart'} />),
  };
});

jest.mock('@/lib/assetService', () => ({
  getAssetHistoryByPeriod: jest.fn(),
  refreshAllPhysicalGoldValues: jest.fn(),
  subscribeToAssets: jest.fn(),
}));

import AssetStatsPage from '@/app/assets/stats/page';
import {
  getAssetHistoryByPeriod,
  refreshAllPhysicalGoldValues,
  subscribeToAssets,
} from '@/lib/assetService';

const mockGetAssetHistory = jest.mocked(getAssetHistoryByPeriod);
const mockRefreshGold = jest.mocked(refreshAllPhysicalGoldValues);
const mockSubscribeToAssets = jest.mocked(subscribeToAssets);

describe('자산 통계 세션 읽기 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionVerified = false;
    mockAdminHouseholdView = null;
    mockGetAssetHistory.mockResolvedValue([]);
    mockRefreshGold.mockResolvedValue(undefined);
    mockSubscribeToAssets.mockImplementation((callback) => {
      callback([]);
      return jest.fn();
    });
  });

  it('인증 복원 전 조회를 실패로 소모하지 않고 복원 직후 자산과 이력을 다시 읽는다', async () => {
    const { rerender } = render(<AssetStatsPage />);

    expect(screen.getByText('불러오는 중...')).toBeInTheDocument();
    expect(mockSubscribeToAssets).not.toHaveBeenCalled();
    expect(mockGetAssetHistory).not.toHaveBeenCalled();
    expect(mockRefreshGold).not.toHaveBeenCalled();

    mockSessionVerified = true;
    rerender(<AssetStatsPage />);

    await waitFor(() => {
      expect(mockSubscribeToAssets).toHaveBeenCalledTimes(1);
      expect(mockGetAssetHistory).toHaveBeenCalledTimes(1);
      expect(mockRefreshGold).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText('불러오는 중...')).not.toBeInTheDocument();
    });
  });

  it('관리자 조회에서는 시세 갱신 명령을 실행하지 않는다', async () => {
    mockSessionVerified = true;
    mockAdminHouseholdView = {
      householdId: 'household-1',
      householdName: '관리 대상 가계부',
    };

    render(<AssetStatsPage />);

    await waitFor(() => {
      expect(mockSubscribeToAssets).toHaveBeenCalledTimes(1);
      expect(mockGetAssetHistory).toHaveBeenCalledTimes(1);
    });
    expect(mockRefreshGold).not.toHaveBeenCalled();
  });
});
