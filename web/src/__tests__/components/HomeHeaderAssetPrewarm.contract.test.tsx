import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockWarmAssetNavigationIntent = jest.fn().mockResolvedValue(undefined);
let mockSessionVerified = true;

jest.mock('@/composition/assetNavigationPrewarm', () => ({
  warmAssetNavigationIntent: () => mockWarmAssetNavigationIntent(),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    themeConfig: {
      titleGradient: 'linear-gradient(#000, #fff)',
    },
  }),
}));

jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: () => ({
    household: { name: '우리집' },
    isSessionVerified: mockSessionVerified,
  }),
}));

import HomeHeader from '@/components/HomeHeader';

describe('HomeHeader asset navigation prewarm contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionVerified = true;
  });

  it('초기 render에서는 준비하지 않고 pointer/focus 탐색 의도에서만 시작한다', () => {
    render(<HomeHeader onSearchClick={jest.fn()} transactionType="expense" />);
    const assetLink = screen.getByRole('link', { name: '자산으로 이동' });

    expect(mockWarmAssetNavigationIntent).not.toHaveBeenCalled();
    fireEvent.pointerDown(assetLink);
    fireEvent.focus(assetLink);
    expect(mockWarmAssetNavigationIntent).toHaveBeenCalledTimes(2);
  });

  it('Auth가 아직 검증되지 않은 paint cache 화면에서는 원격 prewarm을 시작하지 않는다', () => {
    mockSessionVerified = false;
    render(<HomeHeader onSearchClick={jest.fn()} transactionType="expense" />);

    fireEvent.pointerDown(screen.getByRole('link', { name: '자산으로 이동' }));
    expect(mockWarmAssetNavigationIntent).not.toHaveBeenCalled();
  });
});
