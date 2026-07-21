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
  subscribeToStockHoldings,
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
}

export function useStockHoldingManager({ isOpen, asset }: UseStockHoldingManagerOptions) {
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [isLoadingHoldings, setIsLoadingHoldings] = useState(false);

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
      setHoldings([]);
      setIsLoadingHoldings(false);
      resetStockForm();
      resetManualForm();
      return;
    }

    resetStockForm();
    resetManualForm();
    setIsLoadingHoldings(true);

    const unsubscribe = subscribeToStockHoldings(assetId, (newHoldings) => {
      setHoldings(newHoldings);
      setIsLoadingHoldings(false);
    });

    return () => unsubscribe();
  }, [assetId, isOpen, isStockAsset, resetManualForm, resetStockForm]);

  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
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
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
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
    try {
      await addStockHolding({
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
      return true;
    } catch (error) {
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
    try {
      const trimmedName = manualName.trim();
      const inferredManualType: ManualHoldingType =
        trimmedName.includes('예수금') ? 'cash' : 'manual';

      await addStockHolding({
        assetId,
        holdingType: inferredManualType,
        stockCode: '',
        stockName: trimmedName,
        market: 'UNRESOLVED',
        quantity: 1,
        currentPrice: parseInt(manualCurrentValue, 10),
      });
      resetManualForm();
      return true;
    } catch (error) {
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

  const deleteHolding = useCallback(async (holdingId: string) => {
    if (!assetId || !isStockAsset) {
      return false;
    }

    try {
      await deleteStockHolding(holdingId, assetId);
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
