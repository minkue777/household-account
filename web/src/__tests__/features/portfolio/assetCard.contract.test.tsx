import { render, screen } from '@testing-library/react';

import AssetCard from '@/components/assets/AssetCard';
import type { Asset } from '@/types/asset';

describe('AssetCard 금액 표시 계약', () => {
  test('금액은 이전과 같은 비례폭 숫자를 사용하면서 한 줄 정렬을 유지한다', () => {
    const asset: Asset = {
      id: 'housing-subscription',
      aggregateVersion: 1,
      householdId: 'house-1',
      name: '주택청약종합저축',
      type: 'savings',
      currentBalance: 31_100_000,
      currency: 'KRW',
      isActive: true,
      order: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-22T00:00:00.000Z'),
    };

    render(<AssetCard asset={asset} onClick={jest.fn()} />);

    const amount = screen
      .getByRole('button', { name: /주택청약종합저축/ })
      .querySelector('p.whitespace-nowrap');
    expect(amount).not.toHaveClass('tabular-nums');
    expect(amount).toHaveClass('whitespace-nowrap');
    expect(amount).toHaveTextContent('31,100,000원');
  });
});
