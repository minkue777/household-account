import { describe, expect, it } from 'vitest';
import { calculatePortfolioTotals } from '../../../src/contexts/portfolio/core/public';

type AssetType = 'savings' | 'stock' | 'crypto' | 'property' | 'gold' | 'loan';
type LifecycleState = 'active' | 'deleted' | 'purging';
type OwnerRef = { kind: 'household' } | { kind: 'profile'; profileId: string };

interface AssetFact {
  assetId: string;
  type: AssetType;
  ownerRef: OwnerRef;
  currentBalance: number;
  aggregateVersion: number;
  lifecycleState?: LifecycleState;
  legacyIsActive?: boolean;
}

interface PortfolioTotals {
  total: number;
  financial: number;
  byType: Readonly<Record<AssetType, number>>;
  byOwnerRefKey: Readonly<Record<string, number>>;
  sourceAssetVersions: Readonly<Record<string, number>>;
  calculatedAt: string;
}

type PortfolioTotalsResult =
  | { kind: 'success'; value: PortfolioTotals }
  | { kind: 'validation-error'; code: 'INVALID_MONEY'; assetId: string };

/**
 * Portfolio Core가 제공해야 하는 순수 합계 계약입니다.
 * 실제 구현은 이 인터페이스에 맞춰 같은 계약 suite를 실행합니다.
 */
export interface PortfolioTotalsSubject {
  calculate(input: {
    assets: readonly AssetFact[];
    calculatedAt: string;
  }): PortfolioTotalsResult;
}

export function createSubject(): PortfolioTotalsSubject {
  return { calculate: calculatePortfolioTotals };
}

const at = '2026-07-19T12:00:00.000Z';

const asset = (overrides: Partial<AssetFact> & Pick<AssetFact, 'assetId' | 'type'>): AssetFact => ({
  ownerRef: { kind: 'household' },
  currentBalance: 0,
  aggregateVersion: 1,
  lifecycleState: 'active',
  ...overrides,
});

describe('PortfolioTotals 공개 계약', () => {
  it('[T-AST-001][AST-002/AST-004] 대출 부호와 금융자산 제외 규칙을 모든 합계에 동일하게 적용한다', () => {
    const subject = createSubject();
    const result = subject.calculate({
      calculatedAt: at,
      assets: [
        asset({ assetId: 'saving-1', type: 'savings', currentBalance: 100 }),
        asset({ assetId: 'property-1', type: 'property', currentBalance: 500 }),
        asset({ assetId: 'loan-1', type: 'loan', currentBalance: 30 }),
      ],
    });

    expect(result).toEqual({
      kind: 'success',
      value: expect.objectContaining({
        total: 570,
        financial: 100,
        byType: expect.objectContaining({ savings: 100, property: 500, loan: -30 }),
        byOwnerRefKey: { household: 570 },
        sourceAssetVersions: { 'saving-1': 1, 'property-1': 1, 'loan-1': 1 },
        calculatedAt: at,
      }),
    });
  });

  it('[T-AST-002][AST-006] deleted·purging과 legacy isActive=false 자산은 모든 범위에서 제외한다', () => {
    const subject = createSubject();
    const result = subject.calculate({
      calculatedAt: at,
      assets: [
        asset({ assetId: 'active', type: 'stock', currentBalance: 200 }),
        asset({ assetId: 'deleted', type: 'stock', currentBalance: 300, lifecycleState: 'deleted' }),
        asset({ assetId: 'purging', type: 'loan', currentBalance: 40, lifecycleState: 'purging' }),
        asset({
          assetId: 'legacy-deleted',
          type: 'savings',
          currentBalance: 500,
          lifecycleState: undefined,
          legacyIsActive: false,
        }),
      ],
    });

    expect(result).toEqual({
      kind: 'success',
      value: expect.objectContaining({
        total: 200,
        financial: 200,
        byType: expect.objectContaining({ stock: 200, savings: 0, loan: 0 }),
        sourceAssetVersions: { active: 1 },
      }),
    });
  });

  it('[T-AST-002][JOB-AST-003] legacy isActive 누락과 true는 같은 active 의미를 가진다', () => {
    const subject = createSubject();
    const result = subject.calculate({
      calculatedAt: at,
      assets: [
        asset({
          assetId: 'legacy-missing',
          type: 'savings',
          currentBalance: 10,
          lifecycleState: undefined,
          legacyIsActive: undefined,
        }),
        asset({
          assetId: 'legacy-true',
          type: 'gold',
          currentBalance: 20,
          lifecycleState: undefined,
          legacyIsActive: true,
        }),
      ],
    });

    expect(result).toEqual({
      kind: 'success',
      value: expect.objectContaining({ total: 30, financial: 30 }),
    });
  });

  it('[T-AST-005][AST-009] 소유자 이름이 아닌 안정적인 ownerRef key로 합산한다', () => {
    const subject = createSubject();
    const result = subject.calculate({
      calculatedAt: at,
      assets: [
        asset({
          assetId: 'joint',
          type: 'property',
          currentBalance: 700,
          ownerRef: { kind: 'household' },
        }),
        asset({
          assetId: 'child-1',
          type: 'savings',
          currentBalance: 100,
          ownerRef: { kind: 'profile', profileId: 'profile-child' },
        }),
        asset({
          assetId: 'child-2',
          type: 'stock',
          currentBalance: 50,
          ownerRef: { kind: 'profile', profileId: 'profile-child' },
        }),
      ],
    });

    expect(result).toEqual({
      kind: 'success',
      value: expect.objectContaining({
        byOwnerRefKey: {
          household: 700,
          'profile:profile-child': 150,
        },
      }),
    });
  });

  it('[T-AST-004][AST-008] 자산이 하나도 없는 가구도 NoData가 아닌 명시적 0원 합계를 반환한다', () => {
    const subject = createSubject();
    const result = subject.calculate({ assets: [], calculatedAt: at });

    expect(result).toEqual({
      kind: 'success',
      value: {
        total: 0,
        financial: 0,
        byType: {
          savings: 0,
          stock: 0,
          crypto: 0,
          property: 0,
          gold: 0,
          loan: 0,
        },
        byOwnerRefKey: {},
        sourceAssetVersions: {},
        calculatedAt: at,
      },
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    '[T-AST-001][AST-001] 유효하지 않은 금액 %s을 0원으로 보정하지 않고 거부한다',
    (currentBalance) => {
      const subject = createSubject();
      const result = subject.calculate({
        calculatedAt: at,
        assets: [asset({ assetId: 'invalid', type: 'savings', currentBalance })],
      });

      expect(result).toEqual({
        kind: 'validation-error',
        code: 'INVALID_MONEY',
        assetId: 'invalid',
      });
    }
  );
});
