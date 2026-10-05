import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Asset,
  StockHolding,
  isGoldEtfSubType,
} from '@/types/asset';
import {
  addStockHolding,
  refreshAssetMarketValues,
} from '@/lib/assetService';
import { calculateHoldingValue } from '@/lib/assets/holdingValuation';
import { useInstrumentSearch } from './useInstrumentSearch';
import { portfolioQueries } from '@/features/portfolio/application/portfolioQueries';

function sanitizeNumericInput(rawValue: string) {
  return rawValue.replace(/[^0-9]/g, '');
}

function sanitizeDecimalInput(rawValue: string) {
  const cleaned = rawValue.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');

  return firstDot < 0
    ? cleaned
    : `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
}

export type ManualHoldingType = 'manual' | 'cash';

export { calculateHoldingValue } from '@/lib/assets/holdingValuation';

interface UseStockHoldingManagerOptions {
  isOpen: boolean;
  asset: Asset | null;
  holdingsSnapshot?: readonly StockHolding[];
  holdingsReady?: boolean;
}

export function useStockHoldingManager({
  isOpen,
  asset,
  holdingsSnapshot = [],
  holdingsReady = true,
}: UseStockHoldingManagerOptions) {
  const [quantity, setQuantity] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [isAddingHolding, setIsAddingHolding] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualCurrentValue, setManualCurrentValue] = useState('');
  const [isAddingManualHolding, setIsAddingManualHolding] = useState(false);

  const isStockAsset =
    asset?.type === 'stock' || (asset?.type === 'gold' && isGoldEtfSubType(asset?.subType));
  const assetId = asset?.id;
  const search = useInstrumentSearch({ enabled: isOpen && !!assetId && isStockAsset, scopeKey: assetId ?? '',
    search: portfolioQueries.searchStocks, fetchQuote: portfolioQueries.getStockQuote });
  const { query: searchQuery, results: searchResults, searching: isSearching, selected: selectedStock, quote, loadingQuote: isLoadingPrice,
    select: selectStock, setQuery: setSearchQueryFromInput, reset: resetSearch, restore: restoreSearch } = search;
  const currentPrice = quote?.price ?? null;
  const currentPriceInfo = quote;
  const holdings = useMemo(
    () => (
      assetId && isStockAsset
        ? holdingsSnapshot.filter((holding) => holding.assetId === assetId)
        : []
    ),
    [assetId, holdingsSnapshot, isStockAsset]
  );
  const isLoadingHoldings = Boolean(isOpen && isStockAsset && !holdingsReady);

  const resetStockForm = useCallback(() => { resetSearch(); setQuantity(''); setAvgPrice(''); }, [resetSearch]);

  const resetManualForm = useCallback(() => {
    setManualName('');
    setManualCurrentValue('');
  }, []);

  useEffect(() => {
    if (!isOpen || !assetId || !isStockAsset) {
      resetStockForm();
      resetManualForm();
      return;
    }

    resetStockForm();
    resetManualForm();
  }, [assetId, isOpen, isStockAsset, resetManualForm, resetStockForm]);

  const setQuantityInput = useCallback((value: string) => {
    setQuantity(
      selectedStock?.instrumentType === 'fund'
        ? sanitizeDecimalInput(value)
        : sanitizeNumericInput(value)
    );
  }, [selectedStock?.instrumentType]);

  const setAvgPriceInput = useCallback((value: string) => {
    setAvgPrice(
      selectedStock?.instrumentType === 'fund'
        ? sanitizeDecimalInput(value)
        : sanitizeNumericInput(value)
    );
  }, [selectedStock?.instrumentType]);

  const setManualCurrentValueInput = useCallback((value: string) => {
    setManualCurrentValue(sanitizeNumericInput(value));
  }, []);

  const addHolding = useCallback(async () => {
    if (!assetId || !isStockAsset || !selectedStock || !quantity || isAddingHolding) {
      return false;
    }

    setIsAddingHolding(true);
    const submitted = {
      selectedStock,
      quote,
      quantity,
      avgPrice,
      currentPrice,
      currentPriceInfo,
    };
    const pendingAdd = addStockHolding({
      assetId,
      stockCode: selectedStock.code,
      stockName: selectedStock.name,
      market: selectedStock.market,
      quantity: Number(quantity),
      avgPrice: avgPrice ? Number(avgPrice) : undefined,
      currentPrice: currentPriceInfo?.price ?? currentPrice ?? undefined,
      instrumentType:
        currentPriceInfo?.instrumentType || selectedStock.instrumentType || 'stock',
      priceScale: currentPriceInfo?.priceScale || selectedStock.priceScale || 1,
      quoteAsOf: currentPriceInfo?.quoteAsOf,
    });
    resetStockForm();
    try {
      await pendingAdd;
      return true;
    } catch (error) {
      restoreSearch(submitted.selectedStock, submitted.quote);
      setQuantity(submitted.quantity);
      setAvgPrice(submitted.avgPrice);
      console.error('Failed to add stock holding:', error);
      return false;
    } finally {
      setIsAddingHolding(false);
    }
  }, [
    assetId,
    avgPrice,
    currentPrice,
    currentPriceInfo,
    isAddingHolding,
    isStockAsset,
    quantity,
    resetStockForm,
    quote,
    restoreSearch,
    selectedStock,
  ]);

  const addManualHolding = useCallback(async () => {
    if (!assetId || !isStockAsset || !manualName.trim() || !manualCurrentValue || isAddingManualHolding) {
      return false;
    }

    setIsAddingManualHolding(true);
    const submitted = { manualName, manualCurrentValue };
    const trimmedName = manualName.trim();
    const inferredManualType: ManualHoldingType =
      trimmedName.includes('예수금') ? 'cash' : 'manual';
    const pendingAdd = addStockHolding({
      assetId,
      holdingType: inferredManualType,
      stockCode: '',
      stockName: trimmedName,
      market: 'UNRESOLVED',
      quantity: 1,
      currentPrice: parseInt(manualCurrentValue, 10),
    });
    resetManualForm();
    try {
      await pendingAdd;
      return true;
    } catch (error) {
      setManualName(submitted.manualName);
      setManualCurrentValue(submitted.manualCurrentValue);
      console.error('Failed to add manual holding:', error);
      return false;
    } finally {
      setIsAddingManualHolding(false);
    }
  }, [
    assetId,
    isAddingManualHolding,
    isStockAsset,
    manualCurrentValue,
    manualName,
    resetManualForm,
  ]);

  const refreshHoldingPrices = useCallback(async () => {
    if (!assetId || !isStockAsset) {
      return;
    }

    setIsRefreshingPrices(true);
    try {
      await refreshAssetMarketValues(assetId, 'stock');
    } catch (error) {
      console.error('Failed to refresh asset stock prices:', error);
    } finally {
      setIsRefreshingPrices(false);
    }
  }, [assetId, isStockAsset]);

  const totalHoldingValue = useMemo(() => {
    return holdings.reduce((sum, holding) => sum + calculateHoldingValue(holding), 0);
  }, [holdings]);

  return {
    holdings,
    isLoadingHoldings,
    totalHoldingValue,
    searchQuery,
    setSearchQuery: setSearchQueryFromInput,
    searchResults,
    isSearching,
    selectedStock,
    selectStock,
    quantity,
    setQuantityInput,
    avgPrice,
    setAvgPriceInput,
    currentPrice,
    currentPriceInfo,
    isLoadingPrice,
    isAddingHolding,
    addHolding,
    manualName,
    setManualName,
    manualCurrentValue,
    setManualCurrentValueInput,
    isAddingManualHolding,
    addManualHolding,
    resetStockForm,
    resetManualForm,
    isRefreshingPrices,
    refreshHoldingPrices,
  };
}
