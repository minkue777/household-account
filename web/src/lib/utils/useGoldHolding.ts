import { useCallback, useEffect, useMemo, useState } from 'react';
import { Asset, isGoldEtfSubType } from '@/types/asset';
import { refreshAssetMarketValues, updateAsset } from '@/lib/assetService';

export interface GoldPriceData {
  pricePerDon?: number;
  buyPricePerDon: number;
  sellPricePerDon: number;
  timestamp: string;
  estimated?: boolean;
  source?: string;
}

export function getGoldPricePerDon(goldPrice: GoldPriceData) {
  return goldPrice.pricePerDon ?? goldPrice.sellPricePerDon;
}

function sanitizeGoldQuantityInput(rawValue: string) {
  const cleaned = rawValue.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');

  if (firstDot === -1) {
    return cleaned;
  }

  return `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
}

function observedGoldPrice(asset: Asset | null): GoldPriceData | null {
  if (
    asset === null ||
    typeof asset.quantity !== 'number' ||
    !Number.isFinite(asset.quantity) ||
    asset.quantity <= 0 ||
    !Number.isFinite(asset.currentBalance) ||
    asset.currentBalance <= 0
  ) {
    return null;
  }
  const pricePerDon = asset.currentBalance / asset.quantity;
  return {
    pricePerDon,
    buyPricePerDon: pricePerDon,
    sellPricePerDon: pricePerDon,
    timestamp: asset.updatedAt.toISOString(),
    source: 'portfolio-last-success',
  };
}

interface UseGoldHoldingOptions {
  isOpen: boolean;
  asset: Asset | null;
}

function extractGoldQuantity(asset: Asset | null) {
  if (!asset) {
    return '';
  }

  if (typeof asset.quantity === 'number' && Number.isFinite(asset.quantity) && asset.quantity > 0) {
    return asset.quantity.toString();
  }

  const match = asset.memo?.match(/(\d+(?:\.\d+)?)\s*돈/);
  return match ? match[1] : '';
}

export function useGoldHolding({ isOpen, asset }: UseGoldHoldingOptions) {
  const [quantity, setQuantity] = useState('');
  const [goldPrice, setGoldPrice] = useState<GoldPriceData | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isGoldAsset = asset?.type === 'gold';
  const isPhysicalGoldAsset = isGoldAsset && !isGoldEtfSubType(asset?.subType);
  const assetId = asset?.id;

  const setQuantityInput = useCallback((rawValue: string) => {
    setQuantity(sanitizeGoldQuantityInput(rawValue));
  }, []);

  const refreshGoldPrice = useCallback(async () => {
    if (!assetId || !isPhysicalGoldAsset) {
      return null;
    }
    setIsLoadingPrice(true);
    try {
      await refreshAssetMarketValues(assetId, 'physical-gold');
      return null;
    } catch (error) {
      console.error('Failed to refresh asset gold price:', error);
      return null;
    } finally {
      setIsLoadingPrice(false);
    }
  }, [assetId, isPhysicalGoldAsset]);

  useEffect(() => {
    if (!isOpen || !asset || !isPhysicalGoldAsset) {
      setQuantity('');
      setGoldPrice(null);
      return;
    }
    setQuantity(extractGoldQuantity(asset));
    setGoldPrice(observedGoldPrice(asset));
  }, [
    asset,
    asset?.currentBalance,
    asset?.memo,
    asset?.quantity,
    asset?.updatedAt,
    isOpen,
    isPhysicalGoldAsset,
  ]);

  const totalValue = useMemo(() => {
    if (!goldPrice || !quantity) {
      return 0;
    }

    const parsedQuantity = parseFloat(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return 0;
    }

    return Math.round(getGoldPricePerDon(goldPrice) * parsedQuantity);
  }, [goldPrice, quantity]);

  const saveGoldHolding = useCallback(async () => {
    if (!asset || !assetId || !isPhysicalGoldAsset || !goldPrice || !quantity || isSaving) {
      return false;
    }

    if (totalValue <= 0) {
      return false;
    }

    setIsSaving(true);
    try {
      await updateAsset(assetId, {
        currentBalance: totalValue,
        quantity: parseFloat(quantity) || 0,
      }, asset.aggregateVersion);
      return true;
    } catch (error) {
      console.error('Failed to save gold holding:', error);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [asset, assetId, goldPrice, isPhysicalGoldAsset, isSaving, quantity, totalValue]);

  return {
    quantity,
    setQuantityInput,
    goldPrice,
    isLoadingPrice,
    refreshGoldPrice,
    totalValue,
    isSaving,
    saveGoldHolding,
  };
}
