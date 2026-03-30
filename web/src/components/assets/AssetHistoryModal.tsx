'use client';

import { useState, useEffect } from 'react';
import { Asset, ASSET_TYPE_CONFIG } from '@/types/asset';
import { updateAsset } from '@/lib/assetService';
import { ModalOverlay } from '@/components/common';
import { X, Plus, Edit2 } from 'lucide-react';
import { useStockHoldingManager } from '@/lib/utils/useStockHoldingManager';
import { useGoldHolding } from '@/lib/utils/useGoldHolding';
import GoldHoldingSection from './GoldHoldingSection';
import StockSearchForm from './StockSearchForm';
import StockHoldingList from './StockHoldingList';
import { getAssetSignedBalance } from '@/lib/assets/assetMath';
import { ASSET_TYPE_ICON_COMPONENTS } from './assetIcons';

interface AssetHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
  onEditAsset: () => void;
  onViewChart: () => void;
}

export default function AssetHistoryModal({
  isOpen,
  onClose,
  asset,
  onEditAsset,
  onViewChart,
}: AssetHistoryModalProps) {
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [newBalance, setNewBalance] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const stockManager = useStockHoldingManager({ isOpen, asset });

  const goldHolding = useGoldHolding({ isOpen, asset });

  // 모달 열릴 때 자동으로 가격 새로고침 (1회만)
  useEffect(() => {
    if (isOpen && asset?.type === 'stock' && stockManager.holdings.length > 0 && !stockManager.isLoadingHoldings) {
      void stockManager.refreshHoldingPrices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, asset?.type, stockManager.isLoadingHoldings]);

  // 잔액 업데이트 폼 초기화
  useEffect(() => {
    if (showUpdateForm && asset) {
      setNewBalance(asset.currentBalance.toString());
    }
  }, [showUpdateForm, asset]);

  const handleUpdateBalance = async () => {
    if (!asset || isSubmitting) return;

    const balanceNum = parseInt(newBalance, 10);
    if (isNaN(balanceNum)) return;

    setIsSubmitting(true);
    try {
      await updateAsset(asset.id, { currentBalance: balanceNum });
      setShowUpdateForm(false);
    } catch (error) {
      console.error('잔액 업데이트 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddHolding = async () => {
    await stockManager.addHolding();
  };

  const handleSaveGold = async () => {
    const saved = await goldHolding.saveGoldHolding();
    if (saved) {
      onClose();
    }
  };

  if (!isOpen || !asset) return null;

  const config = ASSET_TYPE_CONFIG[asset.type];
  const Icon = ASSET_TYPE_ICON_COMPONENTS[asset.type];
  const isStock = asset.type === 'stock';
  const isGold = asset.type === 'gold';
  const signedBalance = getAssetSignedBalance(asset);
  // 주식 계좌 수익률 계산
  const investmentBase = asset.initialInvestment || asset.costBasis || 0;
  const stockProfitLoss = isStock && investmentBase > 0 ? asset.currentBalance - investmentBase : 0;
  const stockProfitLossRate = isStock && investmentBase > 0 ? (stockProfitLoss / investmentBase) * 100 : 0;
  const showStockProfitLoss = isStock && investmentBase > 0;
  const isStockProfit = stockProfitLoss >= 0;

  return (
    <ModalOverlay onClose={onClose}>
        <div className="bg-white rounded-2xl m-4 max-w-lg w-full shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* 헤더 */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${asset.color || config.color}15`, color: asset.color || config.color }}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{asset.name}</h3>
                  <p className="text-sm text-slate-500">
                    {asset.subType && `${asset.subType} · `}
                    {isStock ? '평가금액 ' : ''}{signedBalance.toLocaleString()}원
                  </p>
                  {showStockProfitLoss && (
                    <p className={`text-sm font-medium ${isStockProfit ? 'text-red-500' : 'text-blue-500'}`}>
                      {isStockProfit ? '+' : ''}{stockProfitLossRate.toFixed(2)}%
                      <span className="ml-1">
                        ({isStockProfit ? '+' : ''}{stockProfitLoss.toLocaleString()}원)
                      </span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onEditAsset}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
                  title="수정"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>

            {/* 버튼들 - 주식/금이 아닐 때만 표시 */}
            {!isStock && !isGold && (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowUpdateForm(true)}
                  className="px-4 py-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  잔액 업데이트
                </button>
                <button
                  type="button"
                  onClick={onViewChart}
                  className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
                >
                  차트
                </button>
              </div>
            )}

          </div>

          {/* 잔액 업데이트 폼 (예적금/부동산) */}
          {!isStock && !isGold && showUpdateForm && (
            <div className="p-4 bg-blue-50 border-b border-blue-100">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    새 잔액
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newBalance ? parseInt(newBalance, 10).toLocaleString() : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setNewBalance(raw);
                      }}
                      className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      원
                    </span>
                  </div>
                  {newBalance && asset && (
                    <p
                      className={`text-sm mt-1 ${
                        parseInt(newBalance, 10) > asset.currentBalance
                          ? 'text-green-500'
                          : parseInt(newBalance, 10) < asset.currentBalance
                          ? 'text-red-500'
                          : 'text-slate-400'
                      }`}
                    >
                      {parseInt(newBalance, 10) > asset.currentBalance
                        ? `+${(parseInt(newBalance, 10) - asset.currentBalance).toLocaleString()}`
                        : parseInt(newBalance, 10) < asset.currentBalance
                        ? (parseInt(newBalance, 10) - asset.currentBalance).toLocaleString()
                        : '변동 없음'}
                      원
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUpdateForm(false)}
                    className="flex-1 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-white transition-colors"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleUpdateBalance}
                    disabled={!newBalance || isSubmitting}
                    className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300"
                  >
                    {isSubmitting ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 주식: 종목 검색 폼 (콘텐츠 영역 밖) */}
          {isStock && (
            <StockSearchForm
              state={{
                searchQuery: stockManager.searchQuery,
                setSearchQuery: stockManager.setSearchQuery,
                searchResults: stockManager.searchResults,
                isSearching: stockManager.isSearching,
                selectedStock: stockManager.selectedStock,
                selectStock: stockManager.selectStock,
                quantity: stockManager.quantity,
                setQuantityInput: stockManager.setQuantityInput,
                avgPrice: stockManager.avgPrice,
                setAvgPriceInput: stockManager.setAvgPriceInput,
                currentPrice: stockManager.currentPrice,
                isLoadingPrice: stockManager.isLoadingPrice,
                isAddingHolding: stockManager.isAddingHolding,
              }}
              onAdd={handleAddHolding}
            />
          )}

          {/* 콘텐츠 영역 */}
          <div className="flex-1 overflow-y-auto p-4">
            {isGold ? (
              <GoldHoldingSection
                state={{
                  quantity: goldHolding.quantity,
                  setQuantityInput: goldHolding.setQuantityInput,
                  goldPrice: goldHolding.goldPrice,
                  isLoadingPrice: goldHolding.isLoadingPrice,
                  refreshGoldPrice: goldHolding.refreshGoldPrice,
                  totalValue: goldHolding.totalValue,
                  isSaving: goldHolding.isSaving,
                }}
                onSave={handleSaveGold}
              />
            ) : isStock ? (
              <StockHoldingList
                holdings={stockManager.holdings}
                isLoading={stockManager.isLoadingHoldings}
                isRefreshing={stockManager.isRefreshingPrices}
                onRefresh={stockManager.refreshHoldingPrices}
                assetId={asset.id}
              />
            ) : (
              // 기타 자산: 메모 표시
              <div className="text-center py-8 text-slate-400">
                {asset.memo || '메모가 없습니다.'}
              </div>
            )}
          </div>
        </div>
    </ModalOverlay>
  );
}
