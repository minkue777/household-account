import { useCallback, useEffect, useMemo, useState } from 'react';
import { Asset, isGoldEtfSubType } from '@/types/asset';
import { updateAsset } from '@/lib/assetService';

export interface GoldPriceData {
  buyPricePerDon: number;
  sellPricePerDon: number;
  timestamp: string;
  estimated?: boolean;
}

function sanitizeGoldQuantityInput(rawValue: string) {
  const cleaned = rawValue.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');

  if (firstDot === -1) {
    return cleaned;
  }

  return `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
}

function normalizeGoldPricePayload(payload: unknown): GoldPriceData | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Record<string, unknown>;

  if (typeof data.buyPricePerDon === 'number' && typeof data.sellPricePerDon === 'number') {
    return {
      buyPricePerDon: data.buyPricePerDon,
      sellPricePerDon: data.sellPricePerDon,
      timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
      estimated: typeof data.estimated === 'boolean' ? data.estimated : undefined,
    };
  }

  if (typeof data.pricePerDon === 'number') {
    return {
      buyPricePerDon: data.pricePerDon,
      sellPricePerDon: data.pricePerDon,
      timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
      estimated: typeof data.estimated === 'boolean' ? data.estimated : undefined,
    };
  }

  return null;
}

interface UseGoldHoldingOptions {
  isOpen: boolean;
  asset: Asset | null;
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
    setIsLoadingPrice(true);
    try {
      const response = await fetch('/api/gold/price');
      if (!response.ok) {
        setGoldPrice(null);
        return null;
      }

      const payload = await response.json();
      const normalized = normalizeGoldPricePayload(payload);
      setGoldPrice(normalized);
      return normalized;
    } catch (error) {
      setGoldPrice(null);
      console.error('Failed to fetch gold price:', error);
      return null;
    } finally {
      setIsLoadingPrice(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !asset || !isPhysicalGoldAsset) {
      setQuantity('');
      setGoldPrice(null);
      return;
    }

    const match = asset.memo?.match(/(\d+(?:\.\d+)?)\s*돈/);
    setQuantity(match ? match[1] : '');

    void refreshGoldPrice();
  }, [asset?.memo, asset?.subType, assetId, isOpen, isPhysicalGoldAsset, refreshGoldPrice]);

  const totalValue = useMemo(() => {
    if (!goldPrice || !quantity) {
      return 0;
    }

    const parsedQuantity = parseFloat(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return 0;
    }

    return Math.round(goldPrice.sellPricePerDon * parsedQuantity);
  }, [goldPrice, quantity]);

  const saveGoldHolding = useCallback(async () => {
    if (!assetId || !isPhysicalGoldAsset || !goldPrice || !quantity || isSaving) {
      return false;
    }

    if (totalValue <= 0) {
      return false;
    }

    setIsSaving(true);
    try {
      await updateAsset(assetId, {
        currentBalance: totalValue,
        memo: `${quantity}돈`,
      });
      return true;
    } catch (error) {
      console.error('Failed to save gold holding:', error);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [assetId, goldPrice, isPhysicalGoldAsset, isSaving, quantity, totalValue]);

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
