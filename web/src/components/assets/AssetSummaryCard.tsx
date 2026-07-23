'use client';

import {
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Asset, ASSET_TYPE_CONFIG, AssetType } from '@/types/asset';
import { ALL_MEMBERS_OPTION } from '@/lib/assets/memberOptions';
import { getAssetSignedBalance, sumSignedAssetBalances } from '@/lib/assets/assetMath';

function formatKoreanUnit(num: number): string {
  if (num === 0) return '0';

  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  const eok = Math.floor(absNum / 100000000);
  const man = Math.floor((absNum % 100000000) / 10000);
  const rest = absNum % 10000;

  const parts: string[] = [];
  if (eok > 0) parts.push(`${eok}억`);
  if (man > 0) parts.push(`${man}만`);
  if (rest > 0) parts.push(`${rest}`);

  return sign + parts.join(' ');
}

interface AssetSummaryCardProps {
  assets: Asset[];
  dailyChange: number;
  previousMonthTotal?: number;
  selectedMember: string;
  memberOptions: Array<{ key: string; label: string }>;
  onMemberChange: (member: string) => void;
  onAddOwner: () => void;
}

interface TooltipState {
  visible: boolean;
  left: number;
  top: number;
  title: string;
  value: string;
  color: string;
}

const ASSET_CHART_COLORS: Record<AssetType, string> = {
  savings: '#3B82F6',
  stock: '#10B981',
  crypto: '#F97316',
  property: '#8B5CF6',
  gold: '#F59E0B',
  loan: '#EF4444',
};

export default function AssetSummaryCard({
  assets,
  dailyChange,
  previousMonthTotal,
  selectedMember,
  memberOptions,
  onMemberChange,
  onAddOwner,
}: AssetSummaryCardProps) {
  const [tooltipState, setTooltipState] = useState<TooltipState>({
    visible: false,
    left: 0,
    top: 0,
    title: '',
    value: '',
    color: '#000000',
  });

  useEffect(() => {
    if (!tooltipState.visible) {
      return;
    }

    const hideTooltip = () => {
      setTooltipState((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    };

    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('touchmove', hideTooltip, { passive: true });

    return () => {
      window.removeEventListener('scroll', hideTooltip, true);
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('touchmove', hideTooltip);
    };
  }, [tooltipState.visible]);

  const filteredAssets = useMemo(() => {
    if (selectedMember === ALL_MEMBERS_OPTION) {
      return assets.filter((asset) => asset.isActive);
    }

    const selectedLabel = memberOptions.find(({ key }) => key === selectedMember)?.label;
    return assets.filter(
      (asset) =>
        asset.isActive &&
        (asset.ownerRef?.kind === 'profile'
          ? asset.ownerRef.profileId === selectedMember
          : asset.owner === selectedLabel)
    );
  }, [assets, memberOptions, selectedMember]);

  const totalBalance = sumSignedAssetBalances(filteredAssets);

  const changeRate = useMemo(() => {
    if (previousMonthTotal && previousMonthTotal > 0) {
      return ((totalBalance - previousMonthTotal) / previousMonthTotal) * 100;
    }

    if (totalBalance > 0 && dailyChange !== 0) {
      const previousTotal = totalBalance - dailyChange;
      if (previousTotal > 0) {
        return (dailyChange / previousTotal) * 100;
      }
    }

    return 0;
  }, [dailyChange, previousMonthTotal, totalBalance]);

  const typeData = useMemo(() => {
    const balances: { type: AssetType; balance: number; percentage: number }[] = [];
    const securedLoanSubTypes = new Set(['주택담보대출', '전세대출']);
    const totalPropertyLinkedLoanBalance = filteredAssets
      .filter((asset) => asset.type === 'loan' && securedLoanSubTypes.has(asset.subType || ''))
      .reduce((sum, asset) => sum + Math.abs(asset.currentBalance || 0), 0);

    (Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).forEach((type) => {
      if (type === 'loan') {
        return;
      }

      const baseBalance = filteredAssets
        .filter((asset) => asset.type === type)
        .reduce((sum, asset) => sum + Math.abs(getAssetSignedBalance(asset)), 0);

      const balance =
        type === 'property' ? Math.max(0, baseBalance - totalPropertyLinkedLoanBalance) : baseBalance;

      if (balance !== 0) {
        balances.push({
          type,
          balance,
          percentage: 0,
        });
      }
    });

    const totalChartBalance = balances.reduce((sum, item) => sum + item.balance, 0);

    return balances
      .map((item) => ({
        ...item,
        percentage: totalChartBalance > 0 ? (item.balance / totalChartBalance) * 100 : 0,
      }))
      .sort((a, b) => b.balance - a.balance);
  }, [filteredAssets]);

  const chartSegments = useMemo(() => {
    let start = 0;
    return typeData.map((item) => {
      const segment = { ...item, start };
      start += item.percentage;
      return segment;
    });
  }, [typeData]);

  const chartBackground = useMemo(() => {
    if (chartSegments.length === 0) return '#E2E8F0';

    const stops = chartSegments.map((item, index) => {
      const end =
        index === chartSegments.length - 1
          ? 100
          : item.start + item.percentage;
      return `${ASSET_CHART_COLORS[item.type]} ${item.start.toFixed(6)}% ${end.toFixed(6)}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [chartSegments]);

  const showTypeTooltip = (
    event: ReactPointerEvent<HTMLDivElement>,
    item: (typeof typeData)[number]
  ) => {
    const chartRect = event.currentTarget.getBoundingClientRect();
    const desiredLeft =
      event.clientX || chartRect.left + chartRect.width / 2;
    const desiredTop = event.clientY || chartRect.top + chartRect.height / 2;
    const tooltipHalfWidth = 110;
    const viewportPadding = 12;

    setTooltipState({
      visible: true,
      left: Math.min(
        Math.max(desiredLeft, tooltipHalfWidth + viewportPadding),
        window.innerWidth - tooltipHalfWidth - viewportPadding
      ),
      top: Math.max(desiredTop - 16, 56),
      title: ASSET_TYPE_CONFIG[item.type].label,
      value: `${item.balance.toLocaleString()}원 (${item.percentage.toFixed(1)}%)`,
      color: ASSET_CHART_COLORS[item.type],
    });
  };

  const handleChartPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (chartSegments.length === 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const normalizedRadius = Math.hypot(x, y) / (rect.width / 2);

    if (normalizedRadius < 0.6 || normalizedRadius > 1) {
      hideTypeTooltip();
      return;
    }

    // CSS conic-gradient는 12시에서 시작해 시계 방향으로 진행합니다.
    const percentage = (
      (Math.atan2(y, x) * 180) / Math.PI + 90 + 360
    ) % 360 / 3.6;
    const item = chartSegments.find((segment, index) => {
      const end =
        index === chartSegments.length - 1
          ? 100
          : segment.start + segment.percentage;
      return percentage >= segment.start && percentage < end;
    });

    if (item) showTypeTooltip(event, item);
  };

  const hideTypeTooltip = () => {
    setTooltipState((previous) =>
      previous.visible ? { ...previous, visible: false } : previous
    );
  };

  const isPositive = dailyChange > 0;

  return (
    <div className="overflow-visible rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="px-5 pb-8 pt-5">
        <p className="mb-1 text-sm text-slate-500">현재 총자산</p>
        <p className="text-2xl font-bold tracking-tight text-slate-900">
          {totalBalance.toLocaleString()}
          <span className="ml-1 text-base font-medium text-slate-400">원</span>
        </p>
        <p className="mt-0.5 text-sm text-slate-400">({formatKoreanUnit(totalBalance)}원)</p>
        {dailyChange !== 0 && (
          <p className={`mt-1 text-sm ${isPositive ? 'text-red-500' : 'text-blue-500'}`}>
            {isPositive ? '+' : ''}
            {changeRate.toFixed(2)}% ({Math.abs(dailyChange).toLocaleString()}원)
          </p>
        )}
      </div>

      <div className="flex gap-6 px-5">
        {memberOptions.map((member) => (
          <button
            key={member.key}
            onClick={() => onMemberChange(member.key)}
            className={`relative pb-2 text-sm font-medium transition-all ${
              selectedMember === member.key ? 'text-blue-500' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {member.label}
            {selectedMember === member.key && (
              <div className="absolute bottom-0 left-1/2 h-0.5 w-full -translate-x-1/2 rounded-full bg-blue-500" />
            )}
          </button>
        ))}
        <button
          type="button"
          aria-label="자산 명의자 추가"
          onClick={onAddOwner}
          className="pb-2 text-lg font-semibold leading-none text-slate-400 hover:text-blue-500"
        >
          +
        </button>
      </div>

      <div className="mx-5 border-t border-slate-100" />

      <div className="p-5">
        <div className="flex items-center">
          <div className="relative -m-[10px] h-[140px] w-[140px] flex-shrink-0 overflow-visible">
            <div
              className="absolute inset-[7px] cursor-pointer rounded-full"
              role="img"
              aria-label="자산 유형별 구성"
              data-renderer="conic-gradient"
              style={{ background: chartBackground }}
              onPointerEnter={handleChartPointer}
              onPointerMove={handleChartPointer}
              onPointerDown={handleChartPointer}
              onPointerLeave={hideTypeTooltip}
            >
              <div className="pointer-events-none absolute inset-[25px] rounded-full bg-white" />
              {chartSegments.map((item) => (
                <span
                  key={item.type}
                  className="sr-only"
                  aria-label={`${ASSET_TYPE_CONFIG[item.type].label} ${item.percentage.toFixed(1)}%`}
                />
              ))}
            </div>
            {tooltipState.visible && (
              <div
                className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
                style={{
                  left: tooltipState.left,
                  top: tooltipState.top,
                }}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: tooltipState.color }}
                  />
                  <span>{tooltipState.title}</span>
                </div>
                <div className="mt-0.5 whitespace-nowrap text-slate-100">{tooltipState.value}</div>
              </div>
            )}
          </div>

          <div className="ml-6 flex-1 space-y-2.5">
            {typeData.map((item) => {
              const config = ASSET_TYPE_CONFIG[item.type];
              return (
                <div key={item.type} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: ASSET_CHART_COLORS[item.type] }}
                    />
                    <span className="text-sm text-slate-600">{config.label}</span>
                  </div>
                  <span className="text-sm font-medium text-slate-800">{item.percentage.toFixed(1)}%</span>
                </div>
              );
            })}
            {typeData.length === 0 && <p className="text-sm text-slate-400">등록된 자산이 없습니다</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
