import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderToString } from 'react-dom/server.node';

import AssetEditModal from '@/components/assets/AssetEditModal';
import { ASSET_TYPE_CONFIG, type Asset } from '@/types/asset';

jest.mock('@/lib/assetService', () => ({
  deleteAsset: jest.fn(),
  updateAsset: jest.fn(),
}));

jest.mock('@/lib/utils/useGoldHolding', () => ({
  getGoldPricePerDon: () => 0,
  useGoldHolding: () => ({
    goldPrice: null,
    isLoadingPrice: false,
    quantity: '',
    setQuantityInput: jest.fn(),
    totalValue: 0,
    refreshGoldPrice: jest.fn(),
  }),
}));

jest.mock('@/components/common/ModalOverlay', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/common/ConfirmDialog', () => ({
  __esModule: true,
  default: () => null,
}));

const propertyAsset: Asset = {
  id: 'property-1',
  aggregateVersion: 1,
  householdId: 'household-1',
  name: '우리 집',
  type: 'property',
  subType: '아파트',
  currentBalance: 700_000_000,
  currency: 'KRW',
  isActive: true,
  order: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-24T00:00:00.000Z'),
};

const savingsAsset: Asset = {
  ...propertyAsset,
  id: 'savings-1',
  name: '생활비 통장',
  type: 'savings',
  subType: '예금',
  currentBalance: 10_000_000,
};

describe('자산 수정 모달 첫 화면 계약', () => {
  test('effect 실행 전 첫 HTML부터 부동산 유형을 표시한다', () => {
    document.body.innerHTML = renderToString(
      <AssetEditModal
        isOpen
        asset={propertyAsset}
        onClose={jest.fn()}
      />
    );

    const propertyType = screen.getByRole('button', { name: '부동산' });
    expect(propertyType).toHaveStyle({
      borderColor: ASSET_TYPE_CONFIG.property.color,
    });
    expect(screen.getByDisplayValue('우리 집')).toBeInTheDocument();
  });

  test('effect 실행 전 첫 HTML부터 예금 세부 유형을 선택해 표시한다', () => {
    document.body.innerHTML = renderToString(
      <AssetEditModal
        isOpen
        asset={savingsAsset}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('예금')).toHaveClass('bg-slate-800', 'text-white');
    expect(screen.getByDisplayValue('생활비 통장')).toBeInTheDocument();
  });
});
