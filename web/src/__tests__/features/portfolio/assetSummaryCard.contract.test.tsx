import { render, screen } from '@testing-library/react';

import AssetSummaryCard from '@/components/assets/AssetSummaryCard';
import { ALL_MEMBERS_OPTION } from '@/lib/assets/memberOptions';
import { ASSET_TYPE_CONFIG, type Asset } from '@/types/asset';

function asset(
  id: string,
  type: Asset['type'],
  currentBalance: number
): Asset {
  return {
    id,
    aggregateVersion: 1,
    householdId: 'household-1',
    name: id,
    type,
    currentBalance,
    currency: 'KRW',
    isActive: true,
    order: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-23T00:00:00.000Z'),
  };
}

describe('자산 요약 구성 차트 계약', () => {
  test('초기 자산 화면에서 유형별 비중과 합계를 즉시 표시한다', () => {
    const { container } = render(
      <AssetSummaryCard
        assets={[
          asset('예금', 'savings', 3_000_000),
          asset('주식', 'stock', 1_000_000),
        ]}
        dailyChange={{ memberKey: ALL_MEMBERS_OPTION, amount: 0 }}
        selectedMember={ALL_MEMBERS_OPTION}
        memberOptions={[{ key: ALL_MEMBERS_OPTION, label: ALL_MEMBERS_OPTION }]}
        onMemberChange={jest.fn()}
        onAddOwner={jest.fn()}
      />
    );

    const chart = screen.getByRole('img', { name: '자산 유형별 구성' });
    expect(chart).toBeInTheDocument();
    expect(chart).toHaveAttribute('data-renderer', 'conic-gradient');
    expect(container.querySelector('circle[stroke-dasharray]')).toBeNull();
    expect(
      screen.getByLabelText(`${ASSET_TYPE_CONFIG.savings.label} 75.0%`)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(`${ASSET_TYPE_CONFIG.stock.label} 25.0%`)
    ).toBeInTheDocument();
    expect(screen.getByText(/4,000,000/)).toBeInTheDocument();
  });

  test('가구원 전환 중에는 직전 가구원의 일간 변동값을 표시하지 않는다', () => {
    const memberOptions = [
      { key: 'member-a', label: '민규' },
      { key: 'member-b', label: '진선' },
    ];
    const assets = [
      {
        ...asset('민규 자산', 'savings', 3_000_000),
        owner: '민규',
        ownerRef: { kind: 'profile' as const, profileId: 'member-a' },
      },
      {
        ...asset('진선 자산', 'savings', 2_000_000),
        owner: '진선',
        ownerRef: { kind: 'profile' as const, profileId: 'member-b' },
      },
    ];
    const { rerender } = render(
      <AssetSummaryCard
        assets={assets}
        dailyChange={{ memberKey: 'member-a', amount: 123_456 }}
        selectedMember="member-a"
        memberOptions={memberOptions}
        onMemberChange={jest.fn()}
        onAddOwner={jest.fn()}
      />
    );

    expect(screen.getByText(/123,456원/)).toBeInTheDocument();

    rerender(
      <AssetSummaryCard
        assets={assets}
        dailyChange={{ memberKey: 'member-a', amount: 123_456 }}
        selectedMember="member-b"
        memberOptions={memberOptions}
        onMemberChange={jest.fn()}
        onAddOwner={jest.fn()}
      />
    );

    expect(screen.queryByText(/123,456원/)).not.toBeInTheDocument();

    rerender(
      <AssetSummaryCard
        assets={assets}
        dailyChange={{ memberKey: 'member-b', amount: 234_567 }}
        selectedMember="member-b"
        memberOptions={memberOptions}
        onMemberChange={jest.fn()}
        onAddOwner={jest.fn()}
      />
    );

    expect(screen.getByText(/234,567원/)).toBeInTheDocument();
  });
});
