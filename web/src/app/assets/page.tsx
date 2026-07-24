'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChartPie } from 'lucide-react';
import { Asset, AssetOwnerOption, AssetType, isGoldEtfSubType } from '@/types/asset';
import {
  subscribeToAssets,
  getRealtimeDailyAssetChangeByOwner,
  addSampleAssets,
  refreshAllMarketValues,
} from '@/lib/assetService';
import AssetSummaryCard from '@/components/assets/AssetSummaryCard';
import AssetList from '@/components/assets/AssetList';
import AssetAddModal from '@/components/assets/AssetAddModal';
import AssetEditModal from '@/components/assets/AssetEditModal';
import AssetHistoryModal from '@/components/assets/AssetHistoryModal';
import AssetOwnerProfileModal from '@/components/assets/AssetOwnerProfileModal';
import { useTheme } from '@/contexts/ThemeContext';
import { useHousehold } from '@/contexts/HouseholdContext';
import {
  ALL_MEMBERS_OPTION,
  HOUSEHOLD_OWNER_OPTION,
} from '@/lib/assets/memberOptions';
import { assetOwnerProfiles } from '@/features/access-household/application/assetOwnerProfiles';
import type { AssetOwnerProfileView } from '@/features/access-household/domain/assetOwnerProfile';
import { getAssetOwnerProfileQueries } from '@/composition/assetOwnerProfileReadRuntime';
import {
  readAssetOwnerProfileSnapshot,
  readAssetSnapshot,
  writeAssetOwnerProfileSnapshot,
  writeAssetSnapshot,
} from '@/features/portfolio/application/portfolioReadSnapshot';
import { useHouseholdHoldingSnapshots } from '@/lib/utils/useHouseholdHoldingSnapshots';

const MARKET_REFRESH_INTERVAL_MS = 30_000;

export default function AssetsPage() {
  const { themeConfig } = useTheme();
  const { household, adminHouseholdView, isSessionVerified = true } = useHousehold();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [dailyChanges, setDailyChanges] = useState<{
    householdId: string | null;
    amounts: Record<string, number>;
  }>({
    householdId: null,
    amounts: {},
  });
  const [isLoading, setIsLoading] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalType, setAddModalType] = useState<AssetType>('savings');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [isAddingSample, setIsAddingSample] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string>(ALL_MEMBERS_OPTION);
  const [ownerProfiles, setOwnerProfiles] = useState<AssetOwnerProfileView[]>([]);
  const cachedAssetsRef = useRef<Asset[] | undefined>(undefined);
  const holdingSnapshots = useHouseholdHoldingSnapshots(
    household?.id,
    isSessionVerified
  );

  const memberOptions = useMemo(
    () => [
      { key: ALL_MEMBERS_OPTION, label: '전체' },
      ...ownerProfiles.map((profile) => ({
        key: profile.profileId,
        label: profile.displayName,
      })),
    ],
    [ownerProfiles]
  );
  const ownerOptions = useMemo<AssetOwnerOption[]>(
    () => [
      {
        key: 'household',
        label: HOUSEHOLD_OWNER_OPTION,
        ownerRef: { kind: 'household' },
      },
      ...ownerProfiles.map((profile) => ({
        key: profile.profileId,
        label: profile.displayName,
        ownerRef: { kind: 'profile' as const, profileId: profile.profileId },
      })),
    ],
    [ownerProfiles]
  );

  const handleAddSampleData = async () => {
    setIsAddingSample(true);
    try {
      await addSampleAssets();
    } catch (error) {
      console.error('샘플 데이터 추가 오류:', error);
    } finally {
      setIsAddingSample(false);
    }
  };

  useLayoutEffect(() => {
    const householdId = household?.id;
    if (!householdId) {
      cachedAssetsRef.current = undefined;
      return;
    }
    const cachedAssets = readAssetSnapshot(householdId);
    const cachedProfiles = readAssetOwnerProfileSnapshot(householdId);
    cachedAssetsRef.current = cachedAssets;
    if (cachedAssets !== undefined) {
      setAssets(cachedAssets);
      setIsLoading(false);
    } else {
      setAssets([]);
      setIsLoading(true);
    }
    if (cachedProfiles !== undefined) {
      setOwnerProfiles(cachedProfiles);
    } else {
      setOwnerProfiles([]);
    }
  }, [household?.id]);

  useEffect(() => {
    let cancelled = false;
    let frameId: number | undefined;
    let delayId: number | undefined;
    let fallbackId: number | undefined;
    let started = false;

    const warm = () => {
      if (cancelled || started) return;
      started = true;
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (delayId !== undefined) window.clearTimeout(delayId);
      if (fallbackId !== undefined) window.clearTimeout(fallbackId);
      void import('@/composition/stockInstrumentCatalogRuntime')
        .then(({ warmStockInstrumentCatalog }) => warmStockInstrumentCatalog())
        .catch((error) => console.error('종목 카탈로그 준비 오류:', error));
    };

    if (typeof window.requestAnimationFrame === 'function') {
      frameId = window.requestAnimationFrame(() => {
        frameId = undefined;
        delayId = window.setTimeout(warm, 0);
      });
      fallbackId = window.setTimeout(warm, 1_000);
    } else {
      delayId = window.setTimeout(warm, 0);
    }

    return () => {
      cancelled = true;
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (delayId !== undefined) window.clearTimeout(delayId);
      if (fallbackId !== undefined) window.clearTimeout(fallbackId);
    };
  }, []);

  useEffect(() => {
    if (!isSessionVerified || !household?.id) return undefined;
    if (cachedAssetsRef.current === undefined) setIsLoading(true);
    const unsubscribe = subscribeToAssets((newAssets) => {
      setAssets(newAssets);
      setIsLoading(false);
      if (household?.id) writeAssetSnapshot(household.id, newAssets);
    }, cachedAssetsRef.current);
    return () => unsubscribe();
  }, [household?.id, isSessionVerified]);

  useEffect(() => {
    if (
      !isSessionVerified
      || !household?.id
      || adminHouseholdView !== null
    ) return undefined;

    let disposed = false;
    let lastStartedAt = 0;

    const refreshMarketValues = (force = false) => {
      if (
        disposed
        || document.visibilityState !== 'visible'
        || (!force && Date.now() - lastStartedAt < MARKET_REFRESH_INTERVAL_MS)
      ) return;

      lastStartedAt = Date.now();
      void refreshAllMarketValues().catch(console.error);
    };

    refreshMarketValues(true);
    const intervalId = window.setInterval(
      refreshMarketValues,
      MARKET_REFRESH_INTERVAL_MS
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshMarketValues();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [adminHouseholdView, household?.id, isSessionVerified]);

  useEffect(() => {
    const householdId = household?.id;
    if (!householdId || !isSessionVerified) {
      setOwnerProfiles([]);
      return;
    }
    return getAssetOwnerProfileQueries().subscribeActive(
      householdId,
      (profiles) => {
        setOwnerProfiles(profiles);
        writeAssetOwnerProfileSnapshot(householdId, profiles);
      },
      (error) => console.error('자산 명의자 구독 오류:', error)
    );
  }, [household?.id, isSessionVerified]);

  useEffect(() => {
    if (!memberOptions.some(({ key }) => key === selectedMember)) {
      setSelectedMember(ALL_MEMBERS_OPTION);
    }
  }, [memberOptions, selectedMember]);

  useEffect(() => {
    const householdId = household?.id;
    if (!isSessionVerified || !householdId) {
      setDailyChanges({ householdId: null, amounts: {} });
      return undefined;
    }

    if (assets.length === 0) {
      setDailyChanges({
        householdId,
        amounts: Object.fromEntries(memberOptions.map(({ key }) => [key, 0])),
      });
      return undefined;
    }

    const activeAssets = assets.filter((asset) => asset.isActive);
    let cancelled = false;

    const syncDailySummary = async () => {
      const entries = await Promise.all(
        memberOptions.map(async ({ key, label }) => {
          try {
            const amount = await getRealtimeDailyAssetChangeByOwner(label, activeAssets);
            return [key, amount] as const;
          } catch {
            return [key, 0] as const;
          }
        })
      );
      if (!cancelled) {
        setDailyChanges({ householdId, amounts: Object.fromEntries(entries) });
      }
    };
    void syncDailySummary();

    return () => {
      cancelled = true;
    };
  }, [assets, household?.id, isSessionVerified, memberOptions]);

  const handleAssetClick = (asset: Asset) => {
    setSelectedAsset(asset);

    if (asset.type === 'gold' && !isGoldEtfSubType(asset.subType)) {
      setShowEditModal(true);
      return;
    }

    if (asset.type === 'stock' || asset.type === 'crypto' || asset.type === 'gold') {
      setShowHistoryModal(true);
      return;
    }

    setShowEditModal(true);
  };

  const handleAddClick = () => {
    setAddModalType('savings');
    setShowAddModal(true);
  };

  const handleEditAsset = () => {
    setShowHistoryModal(false);
    setShowEditModal(true);
  };

  const visibleAssets =
    selectedMember === ALL_MEMBERS_OPTION
      ? assets
      : assets.filter((asset) => {
          if (asset.ownerRef?.kind === 'profile') {
            return asset.ownerRef.profileId === selectedMember;
          }
          const selectedLabel = memberOptions.find(({ key }) => key === selectedMember)?.label;
          return asset.owner === selectedLabel;
        });

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-lg">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="min-w-0 transition-opacity hover:opacity-80">
              <h1
                className="text-lg font-bold leading-tight md:text-2xl"
                style={{
                  background: themeConfig.titleGradient,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {household?.name || '우리집'}
                <br />
                자산
              </h1>
            </Link>

            <Link href="/" className="cursor-pointer transition-opacity hover:opacity-80">
              <img
                src="/bear-removebg-preview.png"
                alt="홈으로 이동"
                className="h-14 w-14 object-contain md:h-16 md:w-16"
              />
            </Link>
          </div>

          <div className="flex items-center gap-2">
            {!isLoading && assets.length === 0 && (
              <button
                onClick={handleAddSampleData}
                disabled={isAddingSample}
                className="text-sm text-blue-500 hover:text-blue-600 disabled:text-slate-400"
              >
                {isAddingSample ? '추가 중...' : '샘플 데이터'}
              </button>
            )}

            <Link
              href="/assets/stats"
              className="rounded-xl border border-slate-200/70 bg-white/95 p-2 shadow-sm transition-all hover:bg-white hover:shadow"
            >
              <ChartPie className="h-5 w-5 text-slate-600" />
            </Link>
          </div>
        </header>

        {isLoading ? (
          <div className="py-12 text-center text-slate-400">로딩 중...</div>
        ) : (
          <div className="space-y-4">
            <AssetSummaryCard
              assets={assets}
              dailyChange={{
                memberKey: selectedMember,
                amount:
                  dailyChanges.householdId === household?.id
                    ? dailyChanges.amounts[selectedMember] ?? 0
                    : 0,
              }}
              selectedMember={selectedMember}
              memberOptions={memberOptions}
              onMemberChange={setSelectedMember}
              onAddOwner={() => setShowOwnerModal(true)}
            />

            <AssetList
              assets={visibleAssets}
              onAssetClick={handleAssetClick}
              onAddClick={handleAddClick}
            />
          </div>
        )}

        {showAddModal && (
          <AssetAddModal
            isOpen={true}
            onClose={() => setShowAddModal(false)}
            defaultType={addModalType}
            defaultOwnerKey={
              selectedMember === ALL_MEMBERS_OPTION ? 'household' : selectedMember
            }
            ownerOptions={ownerOptions}
          />
        )}

        {showOwnerModal && (
          <AssetOwnerProfileModal
            isOpen={true}
            profiles={ownerProfiles}
            onClose={() => setShowOwnerModal(false)}
            onCreate={async (displayName) => {
              if (!household?.id) return;
              await assetOwnerProfiles.create(household.id, displayName);
            }}
            onRename={async (profile, displayName) => {
              if (!household?.id) return;
              await assetOwnerProfiles.rename(
                household.id,
                profile.profileId,
                displayName,
                profile.aggregateVersion
              );
            }}
          />
        )}

        {showEditModal && (
          <AssetEditModal
            key={selectedAsset?.id}
            isOpen={true}
            onClose={() => {
              setShowEditModal(false);
              setSelectedAsset(null);
            }}
            asset={selectedAsset}
          />
        )}

        {showHistoryModal && (
          <AssetHistoryModal
            isOpen={true}
            onClose={() => {
              setShowHistoryModal(false);
              setSelectedAsset(null);
            }}
            asset={selectedAsset}
            onEditAsset={handleEditAsset}
            stockHoldings={holdingSnapshots.stockHoldings}
            cryptoHoldings={holdingSnapshots.cryptoHoldings}
            stockHoldingsReady={holdingSnapshots.stockHoldingsReady}
            cryptoHoldingsReady={holdingSnapshots.cryptoHoldingsReady}
          />
        )}

      </div>
    </main>
  );
}
