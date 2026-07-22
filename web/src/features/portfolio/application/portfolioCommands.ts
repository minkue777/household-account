import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import type { Asset, AssetInput, CryptoHolding, CryptoHoldingInput, StockHolding, StockHoldingInput } from '@/types/asset';

type PositionKind = 'stock' | 'crypto';

/**
 * Callable payload에서 `undefined`는 전송 가능한 JSON 값이 아닙니다.
 * Portfolio patch에서 `undefined`는 필드 삭제가 아니라 "변경하지 않음"을 뜻하므로
 * command 경계에서 일관되게 생략합니다. 숫자 값을 비우려면 도메인이 허용하는 0을
 * 명시적으로 보내야 합니다.
 */
function definedFields(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  );
}

export const portfolioCommands = {
  async createAsset(
    householdId: string,
    asset: AssetInput,
    commandId?: string
  ): Promise<string> {
    const result = await getHouseholdCommandClient().execute(
      'portfolio.create-asset.v1',
      { asset: definedFields(asset) },
      { householdId, ...(commandId ? { commandId, idempotencyKey: commandId } : {}) }
    );
    return result.assetId;
  },

  async updateAsset(
    householdId: string,
    assetId: string,
    changes: Partial<Asset>,
    expectedVersion: number
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'portfolio.update-asset.v1',
      { assetId, changes: definedFields(changes), expectedVersion },
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

  async deleteAsset(
    householdId: string,
    assetId: string,
    expectedVersion: number
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'portfolio.delete-asset.v1',
      { assetId, expectedVersion },
      { householdId }
    );
  },

  async addPosition(
    householdId: string,
    kind: PositionKind,
    input: StockHoldingInput | CryptoHoldingInput,
    commandId?: string
  ): Promise<string> {
    const result = await getHouseholdCommandClient().execute(
      'portfolio.add-position.v1',
      { assetId: input.assetId, positionKind: kind, position: definedFields(input) },
      { householdId, ...(commandId ? { commandId, idempotencyKey: commandId } : {}) }
    );
    return result.positionId;
  },

  async updatePosition(
    householdId: string,
    kind: PositionKind,
    positionId: string,
    assetId: string,
    changes: Partial<StockHolding> | Partial<CryptoHolding>,
    expectedVersion: number
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'portfolio.update-position.v1',
      { assetId, positionId, positionKind: kind, changes: definedFields(changes), expectedVersion },
      { householdId }
    );
  },

  async deletePosition(
    householdId: string,
    kind: PositionKind,
    positionId: string,
    assetId: string,
    expectedVersion: number
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'portfolio.delete-position.v1',
      { assetId, positionId, positionKind: kind, expectedVersion },
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
