'use client';

import { useState, useEffect, useCallback } from 'react';
import { AssetType, AssetInput, ASSET_TYPE_CONFIG, StockSearchResult } from '@/types/asset';
import { addAsset } from '@/lib/assetService';
import Portal from '@/components/Portal';
import { X, Building2, TrendingUp, Home, Search, Loader2 } from 'lucide-react';

interface AssetAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType?: AssetType;
}

const ICONS: Record<AssetType, React.ReactNode> = {
  bank: <Building2 className="w-5 h-5" />,
  investment: <TrendingUp className="w-5 h-5" />,
  property: <Home className="w-5 h-5" />,
};

// 주식/ETF 관련 하위 타입
const STOCK_SUB_TYPES = ['주식', 'ETF'];

export default function AssetAddModal({ isOpen, onClose, defaultType = 'bank' }: AssetAddModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>(defaultType);
  const [subType, setSubType] = useState('');
  const [balance, setBalance] = useState('');
  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 주식/ETF 전용 상태
  const [stockCode, setStockCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);

  // 주식/ETF인지 확인
  const isStockType = type === 'investment' && STOCK_SUB_TYPES.includes(subType);

  // 타입 변경시 하위 타입 초기화
  useEffect(() => {
    setSubType(ASSET_TYPE_CONFIG[type].subTypes[0] || '');
    // 타입 변경시 주식 관련 상태 초기화
    setStockCode('');
    setQuantity('');
    setSearchQuery('');
    setSearchResults([]);
    setCurrentPrice(null);
  }, [type]);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (isOpen) {
      setName('');
      setType(defaultType);
      setSubType(ASSET_TYPE_CONFIG[defaultType].subTypes[0] || '');
      setBalance('');
      setMemo('');
      setStockCode('');
      setQuantity('');
      setSearchQuery('');
      setSearchResults([]);
      setCurrentPrice(null);
    }
  }, [isOpen, defaultType]);

  // 종목 검색
  const searchStocks = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`/api/stock/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setSearchResults(data.results || []);
      setShowSearchResults(true);
    } catch (error) {
      console.error('종목 검색 오류:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // 검색어 변경 시 디바운스 검색
  useEffect(() => {
    if (!isStockType) return;

    const timer = setTimeout(() => {
      if (searchQuery.length >= 2) {
        searchStocks(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, isStockType, searchStocks]);

  // 종목 선택
  const handleSelectStock = async (stock: StockSearchResult) => {
    setName(stock.name);
    setStockCode(stock.code);
    setSearchQuery(stock.name);
    setShowSearchResults(false);

    // 현재가 조회
    setIsLoadingPrice(true);
    try {
      const response = await fetch(`/api/stock/price?code=${stock.code}`);
      if (response.ok) {
        const data = await response.json();
        setCurrentPrice(data.price);
      }
    } catch (error) {
      console.error('시세 조회 오류:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  // 수량 변경시 평가금액 계산
  const calculatedBalance = currentPrice && quantity
    ? currentPrice * parseInt(quantity, 10)
    : 0;

  const handleSubmit = async () => {
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const input: AssetInput = {
        name: name.trim(),
        type,
        subType: subType || undefined,
        currentBalance: isStockType ? calculatedBalance : (parseInt(balance, 10) || 0),
        currency: 'KRW',
        memo: memo.trim() || undefined,
        isActive: true,
        order: Date.now(),
        // 주식/ETF 전용 필드
        stockCode: isStockType ? stockCode : undefined,
        quantity: isStockType ? parseInt(quantity, 10) || undefined : undefined,
      };

      await addAsset(input);
      onClose();
    } catch (error) {
      console.error('자산 추가 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-800">자산 추가</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <div className="space-y-4">
            {/* 자산 타입 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">유형</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map((t) => {
                  const config = ASSET_TYPE_CONFIG[t];
                  const isSelected = type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span style={{ color: isSelected ? config.color : '#64748b' }}>
                        {ICONS[t]}
                      </span>
                      <span
                        className={`text-sm font-medium ${
                          isSelected ? 'text-blue-600' : 'text-slate-600'
                        }`}
                      >
                        {config.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 하위 유형 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                세부 유형
              </label>
              <div className="flex flex-wrap gap-2">
                {ASSET_TYPE_CONFIG[type].subTypes.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setSubType(st)}
                    className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                      subType === st
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* 주식/ETF: 종목 검색 */}
            {isStockType ? (
              <>
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    종목 검색
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setShowSearchResults(true);
                      }}
                      onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
                      placeholder="종목명 검색 (예: 삼성전자, TIGER)"
                      className="w-full px-4 py-2 pl-10 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    {isSearching && (
                      <Loader2 className="w-4 h-4 text-blue-500 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
                    )}
                  </div>

                  {/* 검색 결과 드롭다운 */}
                  {showSearchResults && searchResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map((stock) => (
                        <button
                          key={stock.code}
                          type="button"
                          onClick={() => handleSelectStock(stock)}
                          className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center justify-between"
                        >
                          <div>
                            <p className="font-medium text-slate-800">{stock.name}</p>
                            <p className="text-xs text-slate-500">{stock.code} · {stock.market}</p>
                          </div>
                          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                            {stock.type}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 선택된 종목 정보 */}
                {stockCode && (
                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-slate-800">{name}</p>
                        <p className="text-xs text-slate-500">종목코드: {stockCode}</p>
                      </div>
                      {isLoadingPrice ? (
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                      ) : currentPrice ? (
                        <p className="font-semibold text-blue-600">
                          {currentPrice.toLocaleString()}원
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}

                {/* 보유 수량 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    보유 수량
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="0"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 평가금액 */}
                {currentPrice && quantity && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">평가금액</span>
                      <span className="font-semibold text-slate-800">
                        {calculatedBalance.toLocaleString()}원
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {currentPrice.toLocaleString()}원 × {parseInt(quantity, 10).toLocaleString()}주
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* 일반 자산: 자산명 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    자산명
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={`예: KB은행 ${subType || '예금'}`}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 일반 자산: 현재 잔액 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    현재 잔액
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={balance ? parseInt(balance, 10).toLocaleString() : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setBalance(raw);
                      }}
                      placeholder="0"
                      className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      원
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* 메모 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                메모 (선택)
              </label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="메모 입력"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 버튼 */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || (isStockType && (!stockCode || !quantity)) || isSubmitting}
              className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '추가 중...' : '추가'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
