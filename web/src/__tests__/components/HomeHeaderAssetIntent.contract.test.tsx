import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockRoutePrefetch = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: mockRoutePrefetch }),
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
  }),
}));

import HomeHeader from '@/components/HomeHeader';

describe('HomeHeader asset navigation intent contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('초기 render에서는 준비하지 않고 pointer/focus 탐색 의도에서 route만 한 번 준비한다', () => {
    render(<HomeHeader onSearchClick={jest.fn()} transactionType="expense" />);
    const assetLink = screen.getByRole('link', { name: '자산으로 이동' });

    expect(mockRoutePrefetch).not.toHaveBeenCalled();
    fireEvent.pointerDown(assetLink);
    fireEvent.focus(assetLink);
    expect(mockRoutePrefetch).toHaveBeenCalledTimes(1);
    expect(mockRoutePrefetch).toHaveBeenCalledWith('/assets');
  });
});
