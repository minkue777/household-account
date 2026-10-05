import { act, render, renderHook, screen } from '@testing-library/react';

import { PhysicalGoldFields } from '@/components/assets/AssetFormFields';
import { useGoldHolding } from '@/lib/utils/useGoldHolding';
import type { Asset } from '@/types/asset';

jest.mock('@/lib/assetService', () => ({ refreshAssetMarketValues: jest.fn() }));

const goldAsset: Asset = {
  id: 'gold-a', householdId: 'house-a', aggregateVersion: 1, name: '금',
  type: 'gold', subType: '실물', currency: 'KRW', currentBalance: 1_000_000,
  quantity: 2, isActive: true, order: 0,
  createdAt: new Date('2026-10-05T00:00:00Z'), updatedAt: new Date('2026-10-05T01:00:00Z'),
};

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


test('[T-GOLD-001] 확정 Asset 시세는 첫 렌더와 계좌 전환부터 표시하고 수량 초안은 별도로 유지한다', () => {
  const observed: Array<number | null> = [];
  const { result, rerender } = renderHook(({ asset, isOpen }: { asset: Asset; isOpen: boolean }) => {
    const holding = useGoldHolding({ asset, isOpen });
    observed.push(holding.goldPrice?.pricePerDon ?? null);
    return holding;
  }, { initialProps: { asset: goldAsset, isOpen: true } });
  expect(observed[0]).toBe(500_000);
  act(() => result.current.setQuantityInput('3.5'));
  expect(result.current.totalValue).toBe(1_750_000);
  observed.length = 0;
  rerender({ asset: { ...goldAsset, currentBalance: 1_200_000 }, isOpen: true });
  expect(observed[0]).toBe(600_000);
  expect(result.current.quantity).toBe('3.5');
  expect(result.current.totalValue).toBe(2_100_000);
  observed.length = 0;
  rerender({ asset: { ...goldAsset, id: 'gold-b', currentBalance: 800_000 }, isOpen: true });
  expect(observed[0]).toBe(400_000);
  expect(result.current.quantity).toBe('2');
  observed.length = 0;
  rerender({ asset: goldAsset, isOpen: false });
  expect(observed[0]).toBeNull();
});

test.each([0, Number.NaN, undefined])('[T-GOLD-001] 확정 수량 %s으로 시세를 추정하지 않는다', quantity => {
  const { result } = renderHook(() => useGoldHolding({ isOpen: true, asset: { ...goldAsset, quantity } }));
  expect(result.current.goldPrice).toBeNull();
  expect(result.current.totalValue).toBe(0);
});
