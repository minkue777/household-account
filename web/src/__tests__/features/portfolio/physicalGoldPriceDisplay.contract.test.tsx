import { render, screen } from '@testing-library/react';

import { PhysicalGoldFields } from '@/components/assets/AssetFormFields';

describe('실물 금 시세 표시 계약', () => {
  test('[T-GOLD-001] KRX 금시장 기준가는 원 단위로 반올림하고 소수점을 표시하지 않는다', () => {
    render(
      <PhysicalGoldFields
        quantityValue="1"
        onQuantityChange={jest.fn()}
        goldPrice={{
          pricePerDon: 517_123.6,
          buyPricePerDon: 517_123.6,
          sellPricePerDon: 517_123.6,
          timestamp: '2026-07-28T00:00:00.000Z',
          source: 'naver-krx-gold',
        }}
        isLoadingPrice={false}
        onRefreshPrice={jest.fn()}
      />
    );

    expect(screen.getByText('517,124원')).toBeInTheDocument();
    expect(screen.queryByText(/517,123[.]6/)).not.toBeInTheDocument();
  });
});
