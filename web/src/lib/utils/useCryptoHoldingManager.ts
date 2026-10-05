import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [pendingScope, setPendingScope] = useState<object | null>(null);
  const [refreshingScope, setRefreshingScope] = useState<object | null>(null);

  const isCryptoAsset = asset?.type === 'crypto';
  const assetId = asset?.id;
  const search = useInstrumentSearch({ enabled: isOpen && !!assetId && isCryptoAsset, scopeKey: assetId ?? '',
    search: portfolioQueries.searchCrypto, fetchQuote: portfolioQueries.getCryptoQuote });
  const { query: searchQuery, results: searchResults, searching: isSearching, selected: selectedCoin, quote, loadingQuote: isLoadingPrice,
    select: selectCoin, setQuery: setSearchQueryFromInput, reset: resetSearch } = search;
  const scope = useMemo(() => ({}), [assetId, isOpen, isCryptoAsset]);
  const activeScope = useRef<object | null>(scope);
  activeScope.current = scope;
  useEffect(() => () => { activeScope.current = null; }, []);
  const isAddingHolding = pendingScope === scope;
  const isRefreshingPrices = refreshingScope === scope;
  const draft = useMemo(() => ({ scope, selectedCoin, searchQuery, quantity, avgPrice }),
    [scope, selectedCoin, searchQuery, quantity, avgPrice]);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
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

    setPendingScope(scope);
    const pendingAdd = addCryptoHolding({
      assetId,
      marketCode: selectedCoin.code,
      coinName: selectedCoin.name,
      quantity: parseFloat(quantity),
      avgPrice: avgPrice ? parseInt(avgPrice, 10) : undefined,
      currentPrice: currentPrice ?? undefined,
    });
    try {
      await pendingAdd;
      if (activeScope.current !== scope) return;
      if (currentDraft.current === draft) resetCryptoForm();
      return true;
    } catch (error) {
      if (activeScope.current !== scope) return;
      console.error('Failed to add crypto holding:', error);
      return false;
    } finally {
      setPendingScope(current => current === scope ? null : current);
    }
  }, [assetId, avgPrice, currentPrice, isAddingHolding, isCryptoAsset, quantity, resetCryptoForm, selectedCoin, draft, scope]);

  const refreshHoldingPrices = useCallback(async () => {
    if (!assetId || !isCryptoAsset) {
      return;
    }

    setRefreshingScope(scope);
    try {
      await refreshAssetMarketValues(assetId, 'crypto');
    } catch (error) {
      console.error('Failed to refresh asset crypto prices:', error);
    } finally {
      setRefreshingScope(current => current === scope ? null : current);
    }
  }, [assetId, isCryptoAsset, scope]);

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
