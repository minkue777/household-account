import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import type { Asset, AssetInput, CryptoHolding, CryptoHoldingInput, StockHolding, StockHoldingInput } from '@/types/asset';

type PositionKind = 'stock' | 'crypto';

export const portfolioCommands = {
  async createAsset(householdId: string, asset: AssetInput): Promise<string> {
    const result = await getHouseholdCommandClient().execute(
      'portfolio.create-asset.v1',
      { asset: { ...asset } },
      { householdId }
    );
    return result.assetId;
  },

  async updateAsset(householdId: string, assetId: string, changes: Partial<Asset>): Promise<void> {
    await getHouseholdCommandClient().execute(
      'portfolio.update-asset.v1',
      { assetId, changes: { ...changes } },
      { householdId }
    );
  },

  async reorderAssets(
    householdId: string,
    assets: ReadonlyArray<{ id: string; order: number }>
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'portfolio.reorder-assets.v1',
      { assets: assets.map(({ id, order }) => ({ assetId: id, order })) },
      { householdId }
    );
  },

  async deleteAsset(householdId: string, assetId: string): Promise<void> {
    await getHouseholdCommandClient().execute(
      'portfolio.delete-asset.v1',
      { assetId },
      { householdId }
    );
  },

  async addPosition(
    householdId: string,
    kind: PositionKind,
    input: StockHoldingInput | CryptoHoldingInput
  ): Promise<string> {
    const result = await getHouseholdCommandClient().execute(
      'portfolio.add-position.v1',
      { assetId: input.assetId, positionKind: kind, position: { ...input } },
      { householdId }
    );
    return result.positionId;
  },

  async updatePosition(
    householdId: string,
    kind: PositionKind,
    positionId: string,
    assetId: string,
    changes: Partial<StockHolding> | Partial<CryptoHolding>
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'portfolio.update-position.v1',
      { assetId, positionId, positionKind: kind, changes: { ...changes } },
      { householdId }
    );
  },

  async deletePosition(
    householdId: string,
    kind: PositionKind,
    positionId: string,
    assetId: string
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'portfolio.delete-position.v1',
      { assetId, positionId, positionKind: kind },
      { householdId }
    );
  },

  async refreshMarketValues(
    householdId: string,
    assetClass: 'stock' | 'crypto' | 'physical-gold' | 'all',
    assetId?: string
  ): Promise<number> {
    const result = await getHouseholdCommandClient().execute(
      'portfolio.refresh-market-values.v1',
      { assetClass, ...(assetId ? { assetId } : {}) },
      { householdId }
    );
    return result.refreshedCount;
  },
};
