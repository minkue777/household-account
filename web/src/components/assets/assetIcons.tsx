'use client';

import { ChartCandlestick, Coins, HandCoins, Home, WalletMinimal, LucideIcon } from 'lucide-react';
import { AssetType } from '@/types/asset';

export const ASSET_TYPE_ICON_COMPONENTS: Record<AssetType, LucideIcon> = {
  savings: WalletMinimal,
  stock: ChartCandlestick,
  property: Home,
  gold: Coins,
  loan: HandCoins,
};
