'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { deleteStockHolding, updateStockHolding } from '@/lib/assetService';
import { StockHolding } from '@/types/asset';
import { calculateHoldingValue } from '@/lib/utils/useStockHoldingManager';

interface DividendInfo {
  code: string;
  name: string;
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
  annualDividendPerShare: number | null;
  isEstimated: boolean;
}

interface StockHoldingListProps {
  holdings: StockHolding[];
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  assetId: string;
}

interface HoldingSummaryCardProps {
  holding: StockHolding;
  dividendInfo?: DividendInfo;
  isLoadingDividend: boolean;
  isExpanded: boolean;
  onToggle: (holding: StockHolding) => void;
}

interface CollapsibleSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function getHoldingType(holding: StockHolding) {
  return holding.holdingType || 'stock';
}

function getHoldingTypeLabel(holding: StockHolding) {
  const holdingType = getHoldingType(holding);
  if (holdingType === 'bond') return '채권';
  if (holdingType === 'cash') return '예수금';
  return '주식';
}

function supportsDividendInfo(holding: StockHolding) {
  return (
    getHoldingType(holding) === 'stock' && /^[A-Z0-9]+$/i.test((holding.stockCode || '').trim())
  );
}

function getDividendSummary(dividendInfo?: DividendInfo) {
  if (!dividendInfo) {
    return null;
  }

  if (
    !dividendInfo.isEstimated &&
    dividendInfo.recentDividend &&
    dividendInfo.recentDividend > 0 &&
    dividendInfo.frequency &&
    dividendInfo.frequency > 0
  ) {
    const parts = [
      `최근 지급 ${dividendInfo.recentDividend.toLocaleString()}원`,
      `연 ${dividendInfo.frequency}회`,
    ];

    if (typeof dividendInfo.dividendYield === 'number') {
      parts.push(`수익률 ${dividendInfo.dividendYield.toFixed(2)}%`);
    }

    return parts.join(' · ');
  }

  if (dividendInfo.annualDividendPerShare && dividendInfo.annualDividendPerShare > 0) {
    const parts = [
      `${dividendInfo.isEstimated ? '연간 추정' : '연간 배당'} ${dividendInfo.annualDividendPerShare.toLocaleString()}원`,
    ];

    if (dividendInfo.frequency) {
      parts.push(`연 ${dividendInfo.frequency}회`);
    }

    if (typeof dividendInfo.dividendYield === 'number') {
      parts.push(`수익률 ${dividendInfo.dividendYield.toFixed(2)}%`);
    }

    return parts.join(' · ');
  }

  if (dividendInfo.recentDividend && dividendInfo.frequency) {
    const paymentLabel =
      dividendInfo.frequency === 12
        ? '월배당'
        : dividendInfo.frequency === 4
          ? '분기배당'
          : dividendInfo.frequency === 2
            ? '반기배당'
            : dividendInfo.frequency === 1
              ? '연배당'
              : '배당';

    return `${paymentLabel} ${dividendInfo.recentDividend.toLocaleString()}원 · 연 ${dividendInfo.frequency}회`;
  }

  return null;
}

function getSectionLabel(holdings: StockHolding[], fallbackLabel: string) {
  const total = holdings.reduce((sum, holding) => sum + calculateHoldingValue(holding), 0);
  return `${fallbackLabel} ${total.toLocaleString()}원`;
}

function HoldingSummaryCard({
  holding,
  dividendInfo,
  isLoadingDividend,
  isExpanded,
  onToggle,
}: HoldingSummaryCardProps) {
  const holdingType = getHoldingType(holding);
  const hasAvgPrice = (holding.avgPrice || 0) > 0;
  const hasCurrentPrice = (holding.currentPrice || 0) > 0;
  const holdingProfitLoss =
    hasAvgPrice && hasCurrentPrice
      ? ((holding.currentPrice || 0) - (holding.avgPrice || 0)) * holding.quantity
      : 0;
  const holdingProfitRate =
    hasAvgPrice && hasCurrentPrice && (holding.avgPrice || 0) > 0
      ? (((holding.currentPrice || 0) - (holding.avgPrice || 0)) / (holding.avgPrice || 0)) * 100
      : 0;
  const showHoldingProfit = hasAvgPrice && hasCurrentPrice;
  const isHoldingProfit = holdingProfitLoss >= 0;
  const monthlyDividend =
    dividendInfo?.annualDividendPerShare && dividendInfo.annualDividendPerShare > 0
      ? Math.round((dividendInfo.annualDividendPerShare * holding.quantity) / 12)
      : dividendInfo?.recentDividend && dividendInfo?.frequency
        ? Math.round((dividendInfo.recentDividend * dividendInfo.frequency * holding.quantity) / 12)
        : null;
  const dividendSummary = getDividendSummary(dividendInfo);

  return (
    <button
      type="button"
      onClick={() => onToggle(holding)}
      className="w-full rounded-xl bg-slate-50 p-3 text-left transition-colors hover:bg-slate-100"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${
                isExpanded ? 'rotate-180' : '-rotate-90'
              }`}
            />
            <p className="truncate font-medium text-slate-800">{holding.stockName}</p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {holdingType === 'stock'
              ? `${holding.quantity.toLocaleString()}주${holding.avgPrice ? ` · 평단 ${holding.avgPrice.toLocaleString()}원` : ''}`
              : getHoldingTypeLabel(holding)}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="font-semibold text-slate-800">{calculateHoldingValue(holding).toLocaleString()}원</p>
          {showHoldingProfit ? (
            <p className={`text-xs ${isHoldingProfit ? 'text-red-500' : 'text-blue-500'}`}>
              {isHoldingProfit ? '+' : ''}
              {holdingProfitRate.toFixed(2)}%
              <span className="ml-1">
                ({isHoldingProfit ? '+' : ''}
                {holdingProfitLoss.toLocaleString()})
              </span>
            </p>
          ) : null}
        </div>
      </div>

      {holdingType === 'stock' && isLoadingDividend ? (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <p className="text-xs text-slate-400">배당 정보를 불러오는 중입니다.</p>
        </div>
      ) : holdingType === 'stock' && dividendSummary ? (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 flex-1 text-slate-500">{dividendSummary}</span>
            {monthlyDividend ? (
              <span className="font-medium text-emerald-600">월 {monthlyDividend.toLocaleString()}원</span>
            ) : null}
          </div>
          {dividendInfo?.paymentDate && !dividendInfo.isEstimated ? (
            <p className="mt-0.5 text-xs text-slate-400">최근 지급일: {dividendInfo.paymentDate}</p>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

function CollapsibleSection({ title, isOpen, onToggle, children }: CollapsibleSectionProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="text-sm font-medium text-slate-700">{title}</span>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {isOpen ? <div className="space-y-2 border-t border-slate-100 p-3">{children}</div> : null}
    </div>
  );
}

export default function StockHoldingList({
  holdings,
  isLoading,
  isRefreshing,
  onRefresh,
  assetId,
}: StockHoldingListProps) {
  const [editingHolding, setEditingHolding] = useState<StockHolding | null>(null);
  const [editName, setEditName] = useState('');
  const [editQuantity, setEditQuantity] = useState('');
  const [editAvgPrice, setEditAvgPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dividendInfoMap, setDividendInfoMap] = useState<Record<string, DividendInfo>>({});
  const [loadingDividends, setLoadingDividends] = useState<Set<string>>(new Set());
  const [isStockSectionOpen, setIsStockSectionOpen] = useState(true);
  const [isManualSectionOpen, setIsManualSectionOpen] = useState(true);

  const stockHoldings = useMemo(
    () => holdings.filter((holding) => getHoldingType(holding) === 'stock'),
    [holdings]
  );
  const manualHoldings = useMemo(
    () => holdings.filter((holding) => getHoldingType(holding) !== 'stock'),
    [holdings]
  );
  const hasManualHoldings = manualHoldings.length > 0;

  useEffect(() => {
    if (holdings.length === 0) {
      return;
    }

    holdings.forEach((holding) => {
      if (!supportsDividendInfo(holding)) {
        return;
      }

      if (dividendInfoMap[holding.stockCode] || loadingDividends.has(holding.stockCode)) {
        return;
      }

      setLoadingDividends((prev) => new Set(prev).add(holding.stockCode));

      void (async () => {
        try {
          const response = await fetch(
            `/api/stock/dividend?code=${encodeURIComponent(holding.stockCode)}&name=${encodeURIComponent(holding.stockName)}`
          );

          if (response.ok) {
            const data = (await response.json()) as DividendInfo;
            setDividendInfoMap((prev) => ({ ...prev, [holding.stockCode]: data }));
          }
        } catch (error) {
          console.error('배당 조회 오류:', error);
        } finally {
          setLoadingDividends((prev) => {
            const next = new Set(prev);
            next.delete(holding.stockCode);
            return next;
          });
        }
      })();
    });
  }, [dividendInfoMap, holdings, loadingDividends]);

  useEffect(() => {
    if (!hasManualHoldings) {
      setIsStockSectionOpen(true);
      setIsManualSectionOpen(true);
      return;
    }

    setIsStockSectionOpen(false);
    setIsManualSectionOpen(false);
  }, [assetId, hasManualHoldings]);

  const resetEditingState = () => {
    setEditingHolding(null);
    setEditName('');
    setEditQuantity('');
    setEditAvgPrice('');
  };

  const handleToggleHolding = (holding: StockHolding) => {
    if (editingHolding?.id === holding.id) {
      resetEditingState();
      return;
    }

    setEditingHolding(holding);
    setEditName(holding.stockName);

    if (getHoldingType(holding) === 'stock') {
      setIsStockSectionOpen(true);
      setEditQuantity(holding.quantity.toString());
      setEditAvgPrice(holding.avgPrice?.toString() || '');
    } else {
      setIsManualSectionOpen(true);
      setEditQuantity((holding.currentPrice || 0).toString());
      setEditAvgPrice('');
    }
  };

  const handleSaveHolding = async () => {
    if (!editingHolding || isSubmitting || !editName.trim() || !editQuantity) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (getHoldingType(editingHolding) === 'stock') {
        await updateStockHolding(editingHolding.id, assetId, {
          stockName: editName.trim(),
          quantity: parseInt(editQuantity, 10),
          avgPrice: editAvgPrice ? parseInt(editAvgPrice, 10) : undefined,
        });
      } else {
        await updateStockHolding(editingHolding.id, assetId, {
          stockName: editName.trim(),
          quantity: 1,
          avgPrice: undefined,
          currentPrice: parseInt(editQuantity, 10),
        });
      }

      resetEditingState();
    } catch (error) {
      console.error('보유 항목 수정 오류:', error);
      alert('보유 항목 수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteHolding = async (holdingId: string, stockName: string) => {
    if (!confirm(`${stockName}을(를) 삭제하시겠습니까?`)) {
      return;
    }

    try {
      await deleteStockHolding(holdingId, assetId);
      resetEditingState();
    } catch (error) {
      console.error('보유 항목 삭제 오류:', error);
      alert('보유 항목 삭제에 실패했습니다.');
    }
  };

  const hasRefreshableHolding = stockHoldings.some((holding) => !!holding.stockCode);

  const renderEditableItem = (holding: StockHolding) => (
    <div
      key={`${holding.id}_editor`}
      onClick={(event) => event.stopPropagation()}
      className="space-y-3 border-t border-slate-200 bg-blue-50 p-3"
    >
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-800">{holding.stockName}</p>
        {(holding.currentPrice || 0) > 0 ? (
          <p className="text-sm font-semibold text-red-500">
            {(holding.currentPrice || 0).toLocaleString()}원
          </p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-500">항목명</label>
        <input
          type="text"
          value={editName}
          onChange={(event) => setEditName(event.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
      </div>

      {getHoldingType(holding) === 'stock' ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-slate-500">수량</label>
            <input
              type="text"
              inputMode="numeric"
              value={editQuantity}
              onChange={(event) => setEditQuantity(event.target.value.replace(/[^0-9]/g, ''))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">평단</label>
            <input
              type="text"
              inputMode="numeric"
              value={editAvgPrice ? parseInt(editAvgPrice, 10).toLocaleString() : ''}
              onChange={(event) => setEditAvgPrice(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="mb-1 block text-xs text-slate-500">금액</label>
          <input
            type="text"
            inputMode="numeric"
            value={editQuantity ? parseInt(editQuantity, 10).toLocaleString() : ''}
            onChange={(event) => setEditQuantity(event.target.value.replace(/[^0-9]/g, ''))}
            placeholder="0"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleDeleteHolding(holding.id, holding.stockName)}
          className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
        >
          삭제
        </button>
        <button
          type="button"
          onClick={handleSaveHolding}
          disabled={!editName.trim() || !editQuantity || isSubmitting}
          className="flex-1 rounded-lg bg-blue-500 py-2 text-sm text-white hover:bg-blue-600 disabled:bg-slate-300"
        >
          {isSubmitting ? '저장 중..' : '저장'}
        </button>
      </div>
    </div>
  );

  const renderHoldingItem = (holding: StockHolding) => {
    const isExpanded = editingHolding?.id === holding.id;

    return (
      <div key={holding.id} className="overflow-hidden rounded-xl bg-slate-50">
        <HoldingSummaryCard
          holding={holding}
          dividendInfo={supportsDividendInfo(holding) ? dividendInfoMap[holding.stockCode] : undefined}
          isLoadingDividend={supportsDividendInfo(holding) ? loadingDividends.has(holding.stockCode) : false}
          isExpanded={isExpanded}
          onToggle={handleToggleHolding}
        />
        {isExpanded ? renderEditableItem(holding) : null}
      </div>
    );
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-500">보유 항목</h4>
        {hasRefreshableHolding ? (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? '갱신 중..' : '시세 갱신'}
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-slate-400">로딩 중입니다.</div>
      ) : holdings.length === 0 ? (
        <div className="py-8 text-center text-slate-400">보유 항목이 없습니다.</div>
      ) : hasManualHoldings ? (
        <div className="space-y-3">
          {stockHoldings.length > 0 ? (
            <CollapsibleSection
              title={getSectionLabel(stockHoldings, '주식 종목')}
              isOpen={isStockSectionOpen}
              onToggle={() => setIsStockSectionOpen((prev) => !prev)}
            >
              {stockHoldings.map(renderHoldingItem)}
            </CollapsibleSection>
          ) : null}

          {manualHoldings.length > 0 ? (
            <CollapsibleSection
              title={getSectionLabel(manualHoldings, '수동 추가')}
              isOpen={isManualSectionOpen}
              onToggle={() => setIsManualSectionOpen((prev) => !prev)}
            >
              {manualHoldings.map(renderHoldingItem)}
            </CollapsibleSection>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">{holdings.map(renderHoldingItem)}</div>
      )}
    </>
  );
}
