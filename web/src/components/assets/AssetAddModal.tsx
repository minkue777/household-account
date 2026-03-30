'use client';

import { useEffect, useState } from 'react';
import { AssetInput, AssetType, ASSET_TYPE_CONFIG, StockSearchResult } from '@/types/asset';
import { addAsset, addStockHolding } from '@/lib/assetService';
import { ModalOverlay } from '@/components/common';
import { X, Trash2 } from 'lucide-react';
import { AssetMemoField, AssetTypeGrid } from './AssetFormFields';
import StockSearchForm, { StockSearchState } from './StockSearchForm';
import { HOUSEHOLD_OWNER_OPTION } from '@/lib/assets/memberOptions';

interface AssetAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType?: AssetType;
  defaultOwner?: string;
  ownerOptions: string[];
}

interface PendingStockHolding {
  stockCode: string;
  stockName: string;
  quantity: number;
  avgPrice?: number;
  currentPrice?: number;
}

const PLACEHOLDERS: Record<AssetType, string> = {
  savings: '예: 비상금 통장, 체크카드',
  stock: '예: 주식계좌, ISA, 연금저축',
  property: '예: 전세보증금, 청약통장',
  gold: '예: KRX 금현물, 금통장',
  loan: '예: 전세대출, 신용대출',
};

function sanitizeNumericInput(rawValue: string) {
  return rawValue.replace(/[^0-9]/g, '');
}

export default function AssetAddModal({
  isOpen,
  onClose,
  defaultType = 'savings',
  defaultOwner,
  ownerOptions,
}: AssetAddModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>(defaultType);
  const [subType, setSubType] = useState('');
  const [owner, setOwner] = useState(ownerOptions[0] || HOUSEHOLD_OWNER_OPTION);
  const [balance, setBalance] = useState('');
  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);
  const [quantity, setQuantity] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [isAddingHolding, setIsAddingHolding] = useState(false);
  const [pendingHoldings, setPendingHoldings] = useState<PendingStockHolding[]>([]);

  const resetStockForm = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedStock(null);
    setQuantity('');
    setAvgPrice('');
    setCurrentPrice(null);
  };

  useEffect(() => {
    setName('');
    setBalance('');
    setMemo('');
    setPendingHoldings([]);
    resetStockForm();
  }, [type]);

  useEffect(() => {
    if (!ASSET_TYPE_CONFIG[type].subTypes.includes(subType)) {
      setSubType(ASSET_TYPE_CONFIG[type].subTypes[0] || '');
    }
  }, [subType, type]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setType(defaultType);
    setSubType(ASSET_TYPE_CONFIG[defaultType].subTypes[0] || '');

    const initialOwner =
      defaultOwner && ownerOptions.includes(defaultOwner)
        ? defaultOwner
        : ownerOptions[0] || HOUSEHOLD_OWNER_OPTION;

    setOwner(initialOwner);
    setName('');
    setBalance('');
    setMemo('');
    setPendingHoldings([]);
    resetStockForm();
  }, [defaultOwner, defaultType, isOpen, ownerOptions]);

  useEffect(() => {
    if (type !== 'stock' || searchQuery.length < 1) {
      setSearchResults([]);
      return;
    }

    if (selectedStock && selectedStock.name === searchQuery) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`/api/stock/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await response.json();
        if (!cancelled) {
          setSearchResults(data.results || []);
        }
      } catch (error) {
        if (!cancelled) {
          setSearchResults([]);
        }
        console.error('주식 검색 오류:', error);
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, selectedStock, type]);

  const handleSelectStock = async (stock: StockSearchResult) => {
    setSelectedStock(stock);
    setSearchQuery(stock.name);
    setSearchResults([]);
    setIsLoadingPrice(true);

    try {
      const response = await fetch(`/api/stock/price?code=${stock.code}`);
      if (!response.ok) {
        setCurrentPrice(null);
        return;
      }

      const data = await response.json();
      setCurrentPrice(data.price);
    } catch (error) {
      setCurrentPrice(null);
      console.error('주가 조회 오류:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  const handleAddPendingHolding = async () => {
    if (!selectedStock || !quantity || isAddingHolding) {
      return;
    }

    setIsAddingHolding(true);
    try {
      setPendingHoldings((prev) => [
        ...prev,
        {
          stockCode: selectedStock.code,
          stockName: selectedStock.name,
          quantity: parseInt(quantity, 10),
          avgPrice: avgPrice ? parseInt(avgPrice, 10) : undefined,
          currentPrice: currentPrice || undefined,
        },
      ]);
      resetStockForm();
    } finally {
      setIsAddingHolding(false);
    }
  };

  const handleRemovePendingHolding = (index: number) => {
    setPendingHoldings((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (isSubmitting || !name.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const input: AssetInput = {
        name: name.trim(),
        type,
        subType: subType || undefined,
        owner,
        currentBalance: type === 'stock' ? 0 : parseInt(balance, 10) || 0,
        currency: 'KRW',
        memo: memo.trim() || undefined,
        isActive: true,
        order: Date.now(),
      };

      const assetId = await addAsset(input);

      if (type === 'stock' && pendingHoldings.length > 0) {
        await Promise.all(
          pendingHoldings.map((holding) =>
            addStockHolding({
              assetId,
              stockCode: holding.stockCode,
              stockName: holding.stockName,
              quantity: holding.quantity,
              avgPrice: holding.avgPrice,
              currentPrice: holding.currentPrice,
            })
          )
        );
      }

      onClose();
    } catch (error) {
      console.error('자산 추가 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  const stockSearchState: StockSearchState = {
    searchQuery,
    setSearchQuery: (value) => {
      setSearchQuery(value);
      if (selectedStock) {
        setSelectedStock(null);
        setCurrentPrice(null);
      }
    },
    searchResults,
    isSearching,
    selectedStock,
    selectStock: (stock) => {
      void handleSelectStock(stock);
    },
    quantity,
    setQuantityInput: (value) => setQuantity(sanitizeNumericInput(value)),
    avgPrice,
    setAvgPriceInput: (value) => setAvgPrice(sanitizeNumericInput(value)),
    currentPrice,
    isLoadingPrice,
    isAddingHolding,
  };

  const pendingStockTotal = pendingHoldings.reduce((sum, holding) => {
    const price = holding.currentPrice || holding.avgPrice || 0;
    return sum + price * holding.quantity;
  }, 0);

  return (
    <ModalOverlay onClose={onClose}>
      <div className="m-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">자산 추가</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-slate-100"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">유형</label>
            <AssetTypeGrid value={type} onChange={setType} />
          </div>

          {ASSET_TYPE_CONFIG[type].subTypes.length > 0 && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">세부 유형</label>
              <div className="flex flex-wrap gap-2">
                {ASSET_TYPE_CONFIG[type].subTypes.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSubType(option)}
                    className={`rounded-full px-3 py-1.5 text-sm transition-all ${
                      subType === option
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">소유자</label>
            <div className="flex flex-wrap gap-2">
              {ownerOptions.map((ownerOption) => (
                <button
                  key={ownerOption}
                  type="button"
                  onClick={() => setOwner(ownerOption)}
                  className={`rounded-full px-3 py-1.5 text-sm transition-all ${
                    owner === ownerOption
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {ownerOption}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">계좌명</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={PLACEHOLDERS[type]}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {type !== 'stock' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">현재 금액</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={balance ? parseInt(balance, 10).toLocaleString() : ''}
                  onChange={(e) => setBalance(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-300 px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
              </div>
            </div>
          )}

          {type === 'stock' && (
            <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">보유 종목</label>
                <p className="text-xs text-slate-500">
                  현재 금액은 입력하지 않고, 추가한 종목의 평가금액 합계로 자동 계산됩니다.
                </p>
              </div>

              <StockSearchForm
                state={stockSearchState}
                onAdd={() => {
                  void handleAddPendingHolding();
                }}
              />

              {pendingHoldings.length > 0 && (
                <div className="space-y-2 rounded-xl border border-blue-100 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">추가할 종목</p>
                    <p className="text-xs text-slate-500">
                      예상 평가금액 {pendingStockTotal.toLocaleString()}원
                    </p>
                  </div>
                  {pendingHoldings.map((holding, index) => {
                    const holdingValue =
                      (holding.currentPrice || holding.avgPrice || 0) * holding.quantity;

                    return (
                      <div
                        key={`${holding.stockCode}-${index}`}
                        className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {holding.stockName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {holding.quantity.toLocaleString()}주
                            {holding.avgPrice ? ` · 평단 ${holding.avgPrice.toLocaleString()}원` : ''}
                            {holdingValue > 0 ? ` · ${holdingValue.toLocaleString()}원` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemovePendingHolding(index)}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <AssetMemoField value={memo} onChange={setMemo} />
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-slate-600 transition-colors hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim()}
            className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? '추가 중..' : '추가'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
