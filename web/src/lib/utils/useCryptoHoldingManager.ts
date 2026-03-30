import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Asset, CryptoHolding, CryptoSearchResult } from '@/types/asset';
import {
  addCryptoHolding,
  deleteCryptoHolding,
  subscribeToCryptoHoldings,
  updateCryptoHolding,
} from '@/lib/assetService';

function sanitizeDecimalInput(rawValue: string) {
  const cleaned = rawValue.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');

  if (firstDot === -1) {
    return cleaned;
  }

  return `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
}

export function calculateCryptoHoldingValue(
  holding: Pick<CryptoHolding, 'quantity' | 'currentPrice' | 'avgPrice'>
) {
  const price = holding.currentPrice || holding.avgPrice || 0;
  return price * holding.quantity;
}

interface UseCryptoHoldingManagerOptions {
  isOpen: boolean;
  asset: Asset | null;
}

export function useCryptoHoldingManager({ isOpen, asset }: UseCryptoHoldingManagerOptions) {
  const [holdings, setHoldings] = useState<CryptoHolding[]>([]);
  const [isLoadingHoldings, setIsLoadingHoldings] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CryptoSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState<CryptoSearchResult | null>(null);
  const [quantity, setQuantity] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [isAddingHolding, setIsAddingHolding] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);

  const isCryptoAsset = asset?.type === 'crypto';
  const assetId = asset?.id;
  const holdingsRef = useRef(holdings);

  const resetCryptoForm = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedCoin(null);
    setQuantity('');
    setAvgPrice('');
    setCurrentPrice(null);
  }, []);

  useEffect(() => {
    if (!isOpen || !assetId || !isCryptoAsset) {
      setHoldings([]);
      setIsLoadingHoldings(false);
      resetCryptoForm();
      return;
    }

    resetCryptoForm();
    setIsLoadingHoldings(true);

    const unsubscribe = subscribeToCryptoHoldings(assetId, (newHoldings) => {
      setHoldings(newHoldings);
      holdingsRef.current = newHoldings;
      setIsLoadingHoldings(false);
    });

    return () => unsubscribe();
  }, [assetId, isCryptoAsset, isOpen, resetCryptoForm]);

  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`/api/crypto/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await response.json();
        if (!cancelled) {
          setSearchResults(data.results || []);
        }
      } catch (error) {
        if (!cancelled) {
          setSearchResults([]);
        }
        console.error('Failed to search crypto:', error);
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

  const setSearchQueryFromInput = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (selectedCoin) {
        setSelectedCoin(null);
        setCurrentPrice(null);
      }
    },
    [selectedCoin]
  );

  const setQuantityInput = useCallback((value: string) => {
    setQuantity(sanitizeDecimalInput(value));
  }, []);

  const setAvgPriceInput = useCallback((value: string) => {
    setAvgPrice(value.replace(/[^0-9]/g, ''));
  }, []);

  const selectCoin = useCallback(async (coin: CryptoSearchResult) => {
    setSelectedCoin(coin);
    setSearchQuery(coin.name);
    setSearchResults([]);
    setIsLoadingPrice(true);

    try {
      const response = await fetch(`/api/crypto/price?market=${encodeURIComponent(coin.code)}`);
      if (!response.ok) {
        setCurrentPrice(null);
        return;
      }

      const data = await response.json();
      setCurrentPrice(data.price);
    } catch (error) {
      setCurrentPrice(null);
      console.error('Failed to fetch crypto price:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  }, []);

  const addHolding = useCallback(async () => {
    if (!assetId || !isCryptoAsset || !selectedCoin || !quantity || isAddingHolding) {
      return false;
    }

    setIsAddingHolding(true);
    try {
      await addCryptoHolding({
        assetId,
        marketCode: selectedCoin.code,
        coinName: selectedCoin.name,
        quantity: parseFloat(quantity),
        avgPrice: avgPrice ? parseInt(avgPrice, 10) : undefined,
        currentPrice: currentPrice || undefined,
      });
      resetCryptoForm();
      return true;
    } catch (error) {
      console.error('Failed to add crypto holding:', error);
      return false;
    } finally {
      setIsAddingHolding(false);
    }
  }, [assetId, avgPrice, currentPrice, isAddingHolding, isCryptoAsset, quantity, resetCryptoForm, selectedCoin]);

  const deleteHolding = useCallback(async (holdingId: string) => {
    if (!assetId || !isCryptoAsset) {
      return false;
    }

    try {
      await deleteCryptoHolding(holdingId, assetId);
      return true;
    } catch (error) {
      console.error('Failed to delete crypto holding:', error);
      return false;
    }
  }, [assetId, isCryptoAsset]);

  const refreshHoldingPrices = useCallback(async () => {
    const currentHoldings = holdingsRef.current;
    if (!assetId || !isCryptoAsset || currentHoldings.length === 0) {
      return;
    }

    setIsRefreshingPrices(true);
    try {
      await Promise.all(
        currentHoldings.map(async (holding) => {
          try {
            const response = await fetch(
              `/api/crypto/price?market=${encodeURIComponent(holding.marketCode)}`
            );
            if (!response.ok) return;

            const data = await response.json();
            await updateCryptoHolding(holding.id, assetId, { currentPrice: data.price });
          } catch (error) {
            console.error(`Failed to refresh crypto price (${holding.marketCode}):`, error);
          }
        })
      );
    } finally {
      setIsRefreshingPrices(false);
    }
  }, [assetId, isCryptoAsset]);

  const totalHoldingValue = useMemo(() => {
    return holdings.reduce((sum, holding) => sum + calculateCryptoHoldingValue(holding), 0);
  }, [holdings]);

  return {
    holdings,
    isLoadingHoldings,
    totalHoldingValue,
    searchQuery,
    setSearchQuery: setSearchQueryFromInput,
    searchResults,
    isSearching,
    selectedCoin,
    selectCoin,
    quantity,
    setQuantityInput,
    avgPrice,
    setAvgPriceInput,
    currentPrice,
    isLoadingPrice,
    isAddingHolding,
    addHolding,
    deleteHolding,
    resetCryptoForm,
    isRefreshingPrices,
    refreshHoldingPrices,
  };
}
