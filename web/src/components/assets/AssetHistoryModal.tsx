'use client';

import { useEffect, useState } from 'react';
import { Asset, ASSET_TYPE_CONFIG, isGoldEtfSubType } from '@/types/asset';
import { ModalOverlay } from '@/components/common';
import { X, Edit2 } from 'lucide-react';
import { useStockHoldingManager } from '@/lib/utils/useStockHoldingManager';
import { useCryptoHoldingManager } from '@/lib/utils/useCryptoHoldingManager';
import { getAssetSignedBalance } from '@/lib/assets/assetMath';
import { ASSET_TYPE_ICON_COMPONENTS } from './assetIcons';
import StockSearchForm from './StockSearchForm';
import StockHoldingList from './StockHoldingList';
import ManualHoldingForm from './ManualHoldingForm';
import CryptoSearchForm from './CryptoSearchForm';
import CryptoHoldingList from './CryptoHoldingList';

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
}: AssetHistoryModalProps) {
  const stockManager = useStockHoldingManager({ isOpen, asset });
  const cryptoManager = useCryptoHoldingManager({ isOpen, asset });
  const isGoldEtfAsset = asset?.type === 'gold' && isGoldEtfSubType(asset?.subType);
  const [stockInputMode, setStockInputMode] = useState<'search' | 'manual'>('search');

  useEffect(() => {
    if (isOpen) {
      setStockInputMode('search');
    }
  }, [asset?.id, isOpen]);

  useEffect(() => {
    if (
      isOpen &&
      (asset?.type === 'stock' || isGoldEtfAsset) &&
      stockManager.holdings.length > 0 &&
      !stockManager.isLoadingHoldings
    ) {
      void stockManager.refreshHoldingPrices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, asset?.type, asset?.subType, isGoldEtfAsset, stockManager.isLoadingHoldings]);

  useEffect(() => {
    if (
      isOpen &&
      asset?.type === 'crypto' &&
      cryptoManager.holdings.length > 0 &&
      !cryptoManager.isLoadingHoldings
    ) {
      void cryptoManager.refreshHoldingPrices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, asset?.type, cryptoManager.isLoadingHoldings]);

  if (!isOpen || !asset) return null;

  const config = ASSET_TYPE_CONFIG[asset.type];
  const Icon = ASSET_TYPE_ICON_COMPONENTS[asset.type];
  const isStock = asset.type === 'stock';
  const isCrypto = asset.type === 'crypto';
  const isGoldEtf = asset.type === 'gold' && isGoldEtfSubType(asset.subType);
  const isHoldingManaged = isStock || isCrypto || isGoldEtf;
  const signedBalance = getAssetSignedBalance(asset);
  const investmentBase = asset.initialInvestment || asset.costBasis || 0;
  const holdingProfitLoss =
    isHoldingManaged && investmentBase > 0 ? asset.currentBalance - investmentBase : 0;
  const holdingProfitLossRate =
    isHoldingManaged && investmentBase > 0 ? (holdingProfitLoss / investmentBase) * 100 : 0;
  const showHoldingProfitLoss = isHoldingManaged && investmentBase > 0;
  const isHoldingProfit = holdingProfitLoss >= 0;

  return (
    <ModalOverlay onClose={onClose}>
      <div className="m-4 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="border-b border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full"
                style={{
                  backgroundColor: `${asset.color || config.color}15`,
                  color: asset.color || config.color,
                }}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">{asset.name}</h3>
                <p className="text-sm text-slate-500">
                  {asset.subType ? `${asset.subType} · ` : ''}
                  {isHoldingManaged ? '평가금액 ' : ''}
                  {signedBalance.toLocaleString()}원
                </p>
                {showHoldingProfitLoss && (
                  <p className={`text-sm font-medium ${isHoldingProfit ? 'text-red-500' : 'text-blue-500'}`}>
                    {isHoldingProfit ? '+' : ''}
                    {holdingProfitLossRate.toFixed(2)}%
                    <span className="ml-1">
                      ({isHoldingProfit ? '+' : ''}
                      {holdingProfitLoss.toLocaleString()}원)
                    </span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onEditAsset}
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100"
                title="수정"
              >
                <Edit2 className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 transition-colors hover:bg-slate-100"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
          </div>
        </div>

        {isStock && (
          <div className="border-b border-blue-200 bg-blue-100 px-4 pt-4">
            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setStockInputMode('search')}
                className={`rounded-full px-3 py-1.5 text-sm transition-all ${
                  stockInputMode === 'search'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                종목 검색
              </button>
              <button
                type="button"
                onClick={() => setStockInputMode('manual')}
                className={`rounded-full px-3 py-1.5 text-sm transition-all ${
                  stockInputMode === 'manual'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                수동 추가
              </button>
            </div>
          </div>
        )}

        {(isStock || isGoldEtf) && stockInputMode === 'search' && (
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
            onAdd={async () => {
              await stockManager.addHolding();
            }}
          />
        )}

        {isStock && stockInputMode === 'manual' && (
          <ManualHoldingForm
            holdingType={stockManager.manualHoldingType}
            onHoldingTypeChange={stockManager.setManualHoldingType}
            name={stockManager.manualName}
            onNameChange={stockManager.setManualName}
            currentValue={stockManager.manualCurrentValue}
            onCurrentValueChange={stockManager.setManualCurrentValueInput}
            purchaseValue={stockManager.manualPurchaseValue}
            onPurchaseValueChange={stockManager.setManualPurchaseValueInput}
            isAdding={stockManager.isAddingManualHolding}
            onAdd={async () => {
              await stockManager.addManualHolding();
            }}
          />
        )}

        {isCrypto && (
          <CryptoSearchForm
            state={{
              searchQuery: cryptoManager.searchQuery,
              setSearchQuery: cryptoManager.setSearchQuery,
              searchResults: cryptoManager.searchResults,
              isSearching: cryptoManager.isSearching,
              selectedCoin: cryptoManager.selectedCoin,
              selectCoin: cryptoManager.selectCoin,
              quantity: cryptoManager.quantity,
              setQuantityInput: cryptoManager.setQuantityInput,
              avgPrice: cryptoManager.avgPrice,
              setAvgPriceInput: cryptoManager.setAvgPriceInput,
              currentPrice: cryptoManager.currentPrice,
              isLoadingPrice: cryptoManager.isLoadingPrice,
              isAddingHolding: cryptoManager.isAddingHolding,
            }}
            onAdd={async () => {
              await cryptoManager.addHolding();
            }}
          />
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {isStock || isGoldEtf ? (
            <StockHoldingList
              holdings={stockManager.holdings}
              isLoading={stockManager.isLoadingHoldings}
              isRefreshing={stockManager.isRefreshingPrices}
              onRefresh={stockManager.refreshHoldingPrices}
              assetId={asset.id}
            />
          ) : isCrypto ? (
            <CryptoHoldingList
              holdings={cryptoManager.holdings}
              isLoading={cryptoManager.isLoadingHoldings}
              isRefreshing={cryptoManager.isRefreshingPrices}
              onRefresh={cryptoManager.refreshHoldingPrices}
              assetId={asset.id}
            />
          ) : (
            <div className="py-8 text-center text-slate-400">
              {asset.memo || '메모가 없습니다.'}
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
