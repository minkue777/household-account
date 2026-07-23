import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Asset,
  StockHolding,
  StockPriceInfo,
  StockSearchResult,
  isGoldEtfSubType,
} from '@/types/asset';
import {
  addStockHolding,
  deleteStockHolding,
  refreshAssetMarketValues,
} from '@/lib/assetService';
import { calculateHoldingValue } from '@/lib/assets/holdingValuation';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);
  const [quantity, setQuantity] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [currentPriceInfo, setCurrentPriceInfo] = useState<StockPriceInfo | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [isAddingHolding, setIsAddingHolding] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualCurrentValue, setManualCurrentValue] = useState('');
  const [isAddingManualHolding, setIsAddingManualHolding] = useState(false);

  const isStockAsset =
    asset?.type === 'stock' || (asset?.type === 'gold' && isGoldEtfSubType(asset?.subType));
  const assetId = asset?.id;
  const holdings = useMemo(
    () => (
      assetId && isStockAsset
        ? holdingsSnapshot.filter((holding) => holding.assetId === assetId)
        : []
    ),
    [assetId, holdingsSnapshot, isStockAsset]
  );
  const isLoadingHoldings = Boolean(isOpen && isStockAsset && !holdingsReady);

  const resetStockForm = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedStock(null);
    setQuantity('');
    setAvgPrice('');
    setCurrentPrice(null);
    setCurrentPriceInfo(null);
  }, []);

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

  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      setIsSearching(true);
      try {
        const results = await portfolioQueries.searchStocks(searchQuery);
        if (!cancelled) {
          setSearchResults(results);
        }
      } catch (error) {
        if (!cancelled) {
          setSearchResults([]);
        }
        console.error('Failed to search stocks:', error);
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchQuery]);

  const setSearchQueryFromInput = useCallback((value: string) => {
    setSearchQuery(value);
    if (selectedStock) {
      setSelectedStock(null);
      setCurrentPrice(null);
      setCurrentPriceInfo(null);
    }
  }, [selectedStock]);

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

  const selectStock = useCallback(async (stock: StockSearchResult) => {
    setSelectedStock(stock);
    setSearchQuery(stock.name);
    setSearchResults([]);
    setIsLoadingPrice(true);

    try {
      const data = await portfolioQueries.getStockQuote(stock);
      setCurrentPrice(data.price);
      setCurrentPriceInfo(data);
    } catch (error) {
      setCurrentPrice(null);
      setCurrentPriceInfo(null);
      console.error('Failed to fetch stock price:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  }, []);

  const addHolding = useCallback(async () => {
    if (!assetId || !isStockAsset || !selectedStock || !quantity || isAddingHolding) {
      return false;
    }

    setIsAddingHolding(true);
    const submitted = {
      selectedStock,
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
      currentPrice: currentPriceInfo?.price || currentPrice || undefined,
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
      setSelectedStock(submitted.selectedStock);
      setSearchQuery(submitted.selectedStock.name);
      setQuantity(submitted.quantity);
      setAvgPrice(submitted.avgPrice);
      setCurrentPrice(submitted.currentPrice);
      setCurrentPriceInfo(submitted.currentPriceInfo);
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

  const deleteHolding = useCallback(async (holdingId: string, expectedVersion: number) => {
    if (!assetId || !isStockAsset) {
      return false;
    }

    try {
      await deleteStockHolding(holdingId, assetId, expectedVersion);
      return true;
    } catch (error) {
      console.error('Failed to delete stock holding:', error);
      return false;
    }
  }, [assetId, isStockAsset]);

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
    deleteHolding,
    resetStockForm,
    resetManualForm,
    isRefreshingPrices,
    refreshHoldingPrices,
  };
}
