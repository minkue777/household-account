'use client';

import { Bitcoin, ChartCandlestick, Coins, HandCoins, Home, WalletMinimal, LucideIcon } from 'lucide-react';
import { AssetType } from '@/types/asset';

export const ASSET_TYPE_ICON_COMPONENTS: Record<AssetType, LucideIcon> = {
  savings: WalletMinimal,
  stock: ChartCandlestick,
  crypto: Bitcoin,
  property: Home,
  gold: Coins,
  loan: HandCoins,
};
