import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Asset, StockHolding, StockSearchResult } from '@/types/asset';
import {
  addStockHolding,
  deleteStockHolding,
  subscribeToStockHoldings,
  updateStockHolding,
} from '@/lib/assetService';

function sanitizeNumericInput(rawValue: string) {
  return rawValue.replace(/[^0-9]/g, '');
}

export function calculateHoldingValue(
  holding: Pick<StockHolding, 'quantity' | 'currentPrice' | 'avgPrice'>
) {
  const price = holding.currentPrice || holding.avgPrice || 0;
  return price * holding.quantity;
}

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
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [isAddingHolding, setIsAddingHolding] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);

  const isStockAsset = asset?.type === 'stock';
  const assetId = asset?.id;
  const holdingsRef = useRef(holdings);

  const resetStockForm = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedStock(null);
    setQuantity('');
    setAvgPrice('');
    setCurrentPrice(null);
  }, []);

  useEffect(() => {
    if (!isOpen || !assetId || !isStockAsset) {
      setHoldings([]);
      setIsLoadingHoldings(false);
      resetStockForm();
      return;
    }

    resetStockForm();
    setIsLoadingHoldings(true);

    const unsubscribe = subscribeToStockHoldings(assetId, (newHoldings) => {
      setHoldings(newHoldings);
      holdingsRef.current = newHoldings;
      setIsLoadingHoldings(false);
    });

    return () => unsubscribe();
  }, [assetId, isOpen, isStockAsset, resetStockForm]);

  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([]);
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
    }
  }, [selectedStock]);

  const setQuantityInput = useCallback((value: string) => {
    setQuantity(sanitizeNumericInput(value));
  }, []);

  const setAvgPriceInput = useCallback((value: string) => {
    setAvgPrice(sanitizeNumericInput(value));
  }, []);

  const selectStock = useCallback(async (stock: StockSearchResult) => {
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
        quantity: parseInt(quantity, 10),
        avgPrice: avgPrice ? parseInt(avgPrice, 10) : undefined,
        currentPrice: currentPrice || undefined,
      });
      resetStockForm();
      return true;
    } catch (error) {
      console.error('Failed to add stock holding:', error);
      return false;
    } finally {
      setIsAddingHolding(false);
    }
  }, [assetId, avgPrice, currentPrice, isAddingHolding, isStockAsset, quantity, resetStockForm, selectedStock]);

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
    const currentHoldings = holdingsRef.current;
    if (!assetId || !isStockAsset || currentHoldings.length === 0) {
      return;
    }

    setIsRefreshingPrices(true);
    try {
      await Promise.all(
        currentHoldings.map(async (holding) => {
          try {
            const response = await fetch(`/api/stock/price?code=${holding.stockCode}`);
            if (!response.ok) return;

            const data = await response.json();
            await updateStockHolding(holding.id, assetId, { currentPrice: data.price });
          } catch (error) {
            console.error(`Failed to refresh stock price (${holding.stockCode}):`, error);
          }
        })
      );
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
    isLoadingPrice,
    isAddingHolding,
    addHolding,
    deleteHolding,
    resetStockForm,
    isRefreshingPrices,
    refreshHoldingPrices,
  };
}
