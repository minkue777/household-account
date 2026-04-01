'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { deleteStockHolding, updateStockHolding } from '@/lib/assetService';
import { calculateHoldingValue } from '@/lib/utils/useStockHoldingManager';
import { StockHolding } from '@/types/asset';

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
  onOpen: (holding: StockHolding) => void;
}

interface HoldingEditorCardProps {
  holding: StockHolding;
  editName: string;
  editQuantity: string;
  editAvgPrice: string;
  isSubmitting: boolean;
  onChangeName: (value: string) => void;
  onChangeQuantity: (value: string) => void;
  onChangeAvgPrice: (value: string) => void;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
}

interface CollapsibleSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function sanitizeIntegerInput(rawValue: string) {
  return rawValue.replace(/[^0-9]/g, '');
}

function getHoldingType(holding: StockHolding) {
  return holding.holdingType || 'stock';
}

function getHoldingTypeLabel(holding: StockHolding) {
  const holdingType = getHoldingType(holding);

  if (holdingType === 'bond') {
    return '채권';
  }

  if (holdingType === 'cash') {
    return '예수금';
  }

  return '주식';
}

function supportsDividendInfo(holding: StockHolding) {
  return getHoldingType(holding) === 'stock' && /^[A-Z0-9]+$/i.test((holding.stockCode || '').trim());
}

function formatCompactAmount(value: number) {
  const absoluteValue = Math.abs(Math.trunc(value));
  const sign = value < 0 ? '-' : '';

  if (absoluteValue >= 10000) {
    return `${sign}${Math.floor(absoluteValue / 10000)}만`;
  }

  return `${sign}${absoluteValue.toLocaleString()}원`;
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
    return `최근 지급 ${dividendInfo.recentDividend.toLocaleString()}원 · 연 ${dividendInfo.frequency}회`;
  }

  if (dividendInfo.annualDividendPerShare && dividendInfo.annualDividendPerShare > 0) {
    const prefix = dividendInfo.isEstimated ? '연간 추정' : '연간 배당';

    if (dividendInfo.frequency && dividendInfo.frequency > 0) {
      return `${prefix} ${dividendInfo.annualDividendPerShare.toLocaleString()}원 · 연 ${dividendInfo.frequency}회`;
    }

    return `${prefix} ${dividendInfo.annualDividendPerShare.toLocaleString()}원`;
  }

  return null;
}

function getSectionLabel(holdings: StockHolding[], fallbackLabel: string) {
  const total = holdings.reduce((sum, holding) => sum + calculateHoldingValue(holding), 0);
  return `${fallbackLabel} ${formatCompactAmount(total)}`;
}

function HoldingSummaryCard({
  holding,
  dividendInfo,
  isLoadingDividend,
  onOpen,
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
  const dividendSummary = getDividendSummary(dividendInfo);
  const dividendYieldLabel =
    typeof dividendInfo?.dividendYield === 'number'
      ? `배당수익률 ${dividendInfo.dividendYield.toFixed(2)}%`
      : null;
  const valueLabel = formatCompactAmount(calculateHoldingValue(holding));
  const profitAmountLabel = formatCompactAmount(holdingProfitLoss);

  return (
    <button
      type="button"
      onClick={() => onOpen(holding)}
      className="w-full rounded-xl bg-slate-50 p-3 text-left transition-colors hover:bg-slate-100"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-800">{holding.stockName}</p>
          <p className="mt-1 text-xs text-slate-500">
            {holdingType === 'stock'
              ? `수량 ${holding.quantity.toLocaleString()}주${holding.avgPrice ? ` · 평단 ${holding.avgPrice.toLocaleString()}원` : ''}`
              : getHoldingTypeLabel(holding)}
          </p>
        </div>

        <div className="flex-shrink-0 text-right">
          <p className="font-semibold text-slate-800">{valueLabel}</p>
          {showHoldingProfit ? (
            <p className={`text-xs ${isHoldingProfit ? 'text-red-500' : 'text-blue-500'}`}>
              {isHoldingProfit ? '+' : ''}
              {holdingProfitRate.toFixed(2)}%
              <span className="ml-1">
                ({isHoldingProfit ? '+' : ''}
                {profitAmountLabel})
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
          <p className="text-xs text-slate-500">{dividendSummary}</p>
          {dividendYieldLabel ? <p className="mt-1 text-xs text-slate-400">{dividendYieldLabel}</p> : null}
          {dividendInfo?.paymentDate && !dividendInfo.isEstimated ? (
            <p className="mt-0.5 text-xs text-slate-400">최근 지급일: {dividendInfo.paymentDate}</p>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

function HoldingEditorCard({
  holding,
  editName,
  editQuantity,
  editAvgPrice,
  isSubmitting,
  onChangeName,
  onChangeQuantity,
  onChangeAvgPrice,
  onClose,
  onDelete,
  onSave,
}: HoldingEditorCardProps) {
  const holdingType = getHoldingType(holding);
  const topRightLabel =
    holdingType === 'stock'
      ? holding.currentPrice
        ? `${holding.currentPrice.toLocaleString()}원`
        : `${calculateHoldingValue(holding).toLocaleString()}원`
      : `${calculateHoldingValue(holding).toLocaleString()}원`;

  return (
    <div onClick={onClose} className="space-y-3 rounded-xl bg-blue-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{holding.stockName}</p>
          <p className="text-xs text-slate-500">
            {holdingType === 'stock' ? holding.stockCode : getHoldingTypeLabel(holding)}
          </p>
        </div>
        <p className="flex-shrink-0 text-sm font-semibold text-blue-600">{topRightLabel}</p>
      </div>

      <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
        <div>
          <label className="mb-1 block text-xs text-slate-500">종목명</label>
          <input
            type="text"
            value={editName}
            onChange={(event) => onChangeName(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        {holdingType === 'stock' ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">수량</label>
              <input
                type="text"
                inputMode="numeric"
                value={editQuantity ? parseInt(editQuantity, 10).toLocaleString() : ''}
                onChange={(event) => onChangeQuantity(sanitizeIntegerInput(event.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">평단</label>
              <input
                type="text"
                inputMode="numeric"
                value={editAvgPrice ? parseInt(editAvgPrice, 10).toLocaleString() : ''}
                onChange={(event) => onChangeAvgPrice(sanitizeIntegerInput(event.target.value))}
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
              onChange={(event) => onChangeQuantity(sanitizeIntegerInput(event.target.value))}
              placeholder="0"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onDelete}
          className="flex-1 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-500 transition-colors hover:bg-red-50"
        >
          삭제
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!editName.trim() || !editQuantity || isSubmitting}
          className="flex-1 rounded-lg bg-blue-500 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:bg-slate-300"
        >
          {isSubmitting ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
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

  const handleOpenHolding = (holding: StockHolding) => {
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
      return;
    }

    setIsManualSectionOpen(true);
    setEditQuantity((holding.currentPrice || 0).toString());
    setEditAvgPrice('');
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
    if (!confirm(`${stockName}을 삭제하시겠습니까?`)) {
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

  const renderHoldingItem = (holding: StockHolding) => {
    if (editingHolding?.id === holding.id) {
      return (
        <HoldingEditorCard
          key={holding.id}
          holding={holding}
          editName={editName}
          editQuantity={editQuantity}
          editAvgPrice={editAvgPrice}
          isSubmitting={isSubmitting}
          onChangeName={setEditName}
          onChangeQuantity={setEditQuantity}
          onChangeAvgPrice={setEditAvgPrice}
          onClose={resetEditingState}
          onDelete={() => void handleDeleteHolding(holding.id, holding.stockName)}
          onSave={() => void handleSaveHolding()}
        />
      );
    }

    return (
      <HoldingSummaryCard
        key={holding.id}
        holding={holding}
        dividendInfo={supportsDividendInfo(holding) ? dividendInfoMap[holding.stockCode] : undefined}
        isLoadingDividend={supportsDividendInfo(holding) ? loadingDividends.has(holding.stockCode) : false}
        onOpen={handleOpenHolding}
      />
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
            {isRefreshing ? '갱신 중...' : '시세 갱신'}
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
