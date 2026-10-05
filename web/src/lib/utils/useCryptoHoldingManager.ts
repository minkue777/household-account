import { useCallback, useEffect, useMemo, useState } from 'react';
import { Asset, CryptoHolding } from '@/types/asset';
import {
  addCryptoHolding,
  refreshAssetMarketValues,
} from '@/lib/assetService';
import { useInstrumentSearch } from './useInstrumentSearch';
import { portfolioQueries } from '@/features/portfolio/application/portfolioQueries';
import { calculateHoldingValue as calculateCryptoHoldingValue } from '@/lib/assets/holdingValuation';

function sanitizeDecimalInput(rawValue: string) {
  const cleaned = rawValue.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');

  if (firstDot === -1) {
    return cleaned;
  }

  return `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
}

export { calculateHoldingValue as calculateCryptoHoldingValue } from '@/lib/assets/holdingValuation';

interface UseCryptoHoldingManagerOptions {
  isOpen: boolean;
  asset: Asset | null;
  holdingsSnapshot?: readonly CryptoHolding[];
  holdingsReady?: boolean;
}

export function useCryptoHoldingManager({
  isOpen,
  asset,
  holdingsSnapshot = [],
  holdingsReady = true,
}: UseCryptoHoldingManagerOptions) {
  const [quantity, setQuantity] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [isAddingHolding, setIsAddingHolding] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);

  const isCryptoAsset = asset?.type === 'crypto';
  const assetId = asset?.id;
  const search = useInstrumentSearch({ enabled: isOpen && !!assetId && isCryptoAsset, scopeKey: assetId ?? '',
    search: portfolioQueries.searchCrypto, fetchQuote: portfolioQueries.getCryptoQuote });
  const { query: searchQuery, results: searchResults, searching: isSearching, selected: selectedCoin, quote, loadingQuote: isLoadingPrice,
    select: selectCoin, setQuery: setSearchQueryFromInput, reset: resetSearch, restore: restoreSearch } = search;
  const currentPrice = quote?.price ?? null;
  const holdings = useMemo(
    () => (
      assetId && isCryptoAsset
        ? holdingsSnapshot.filter((holding) => holding.assetId === assetId)
        : []
    ),
    [assetId, holdingsSnapshot, isCryptoAsset]
  );
  const isLoadingHoldings = Boolean(isOpen && isCryptoAsset && !holdingsReady);

  const resetCryptoForm = useCallback(() => { resetSearch(); setQuantity(''); setAvgPrice(''); }, [resetSearch]);

  useEffect(() => {
    if (!isOpen || !assetId || !isCryptoAsset) {
      resetCryptoForm();
      return;
    }

    resetCryptoForm();
  }, [assetId, isCryptoAsset, isOpen, resetCryptoForm]);

  const setQuantityInput = useCallback((value: string) => {
    setQuantity(sanitizeDecimalInput(value));
  }, []);

  const setAvgPriceInput = useCallback((value: string) => {
    setAvgPrice(value.replace(/[^0-9]/g, ''));
  }, []);

  const addHolding = useCallback(async () => {
    if (!assetId || !isCryptoAsset || !selectedCoin || !quantity || isAddingHolding) {
      return false;
    }

    setIsAddingHolding(true);
    const submitted = { selectedCoin, quantity, avgPrice, currentPrice, quote };
    const pendingAdd = addCryptoHolding({
      assetId,
      marketCode: selectedCoin.code,
      coinName: selectedCoin.name,
      quantity: parseFloat(quantity),
      avgPrice: avgPrice ? parseInt(avgPrice, 10) : undefined,
      currentPrice: currentPrice ?? undefined,
    });
    resetCryptoForm();
    try {
      await pendingAdd;
      return true;
    } catch (error) {
      restoreSearch(submitted.selectedCoin, submitted.quote);
      setQuantity(submitted.quantity);
      setAvgPrice(submitted.avgPrice);
      console.error('Failed to add crypto holding:', error);
      return false;
    } finally {
      setIsAddingHolding(false);
    }
  }, [assetId, avgPrice, currentPrice, isAddingHolding, isCryptoAsset, quantity, resetCryptoForm, selectedCoin]);

  const refreshHoldingPrices = useCallback(async () => {
    if (!assetId || !isCryptoAsset) {
      return;
    }

    setIsRefreshingPrices(true);
    try {
      await refreshAssetMarketValues(assetId, 'crypto');
    } catch (error) {
      console.error('Failed to refresh asset crypto prices:', error);
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
    resetCryptoForm,
    isRefreshingPrices,
    refreshHoldingPrices,
  };
}
