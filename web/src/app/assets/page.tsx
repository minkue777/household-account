'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChartPie } from 'lucide-react';
import { Asset, AssetOwnerOption, AssetType, isGoldEtfSubType } from '@/types/asset';
import {
  subscribeToAssets,
  getRealtimeDailyAssetChangeByOwner,
  addSampleAssets,
  refreshAllMarketValues,
} from '@/lib/assetService';
import {
  AssetSummaryCard,
  AssetList,
  AssetAddModal,
  AssetEditModal,
  AssetHistoryModal,
  AssetBalanceChart,
  AssetOwnerProfileModal,
} from '@/components/assets';
import { useTheme } from '@/contexts/ThemeContext';
import { useHousehold } from '@/contexts/HouseholdContext';
import {
  ALL_MEMBERS_OPTION,
  HOUSEHOLD_OWNER_OPTION,
} from '@/lib/assets/memberOptions';
import { assetOwnerProfiles } from '@/features/access-household/application/assetOwnerProfiles';
import type { AssetOwnerProfileWireView } from '@/platform/functions-api';

export default function AssetsPage() {
  const { themeConfig } = useTheme();
  const { household } = useHousehold();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [dailyChange, setDailyChange] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalType, setAddModalType] = useState<AssetType>('savings');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showChartModal, setShowChartModal] = useState(false);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [isAddingSample, setIsAddingSample] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string>(ALL_MEMBERS_OPTION);
  const [ownerProfiles, setOwnerProfiles] = useState<AssetOwnerProfileWireView[]>([]);

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

  const loadOwnerProfiles = useCallback(async () => {
    if (!household?.id) {
      setOwnerProfiles([]);
      return;
    }
    try {
      const result = await assetOwnerProfiles.list(household.id);
      setOwnerProfiles(result.profiles);
    } catch {
      setOwnerProfiles([]);
    }
  }, [household?.id]);

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

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeToAssets((newAssets) => {
      setAssets(newAssets);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    refreshAllMarketValues().catch(console.error);
  }, []);

  useEffect(() => {
    void loadOwnerProfiles();
  }, [loadOwnerProfiles]);

  useEffect(() => {
    if (!memberOptions.some(({ key }) => key === selectedMember)) {
      setSelectedMember(ALL_MEMBERS_OPTION);
    }
  }, [memberOptions, selectedMember]);

  useEffect(() => {
    if (assets.length === 0) {
      setDailyChange(0);
      return;
    }

    const activeAssets = assets.filter((asset) => asset.isActive);

    const syncDailySummary = async () => {
      try {
        const selectedLabel =
          memberOptions.find(({ key }) => key === selectedMember)?.label ?? ALL_MEMBERS_OPTION;
        const change = await getRealtimeDailyAssetChangeByOwner(selectedLabel, activeAssets);
        setDailyChange(change);
      } catch {
        setDailyChange(0);
      }
    };

    void syncDailySummary();
  }, [assets, memberOptions, selectedMember]);

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

  const handleViewChart = () => {
    setShowHistoryModal(false);
    setShowChartModal(true);
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
              dailyChange={dailyChange}
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

        <AssetAddModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          defaultType={addModalType}
          defaultOwnerKey={
            selectedMember === ALL_MEMBERS_OPTION ? 'household' : selectedMember
          }
          ownerOptions={ownerOptions}
        />

        <AssetOwnerProfileModal
          isOpen={showOwnerModal}
          profiles={ownerProfiles}
          onClose={() => setShowOwnerModal(false)}
          onCreate={async (displayName) => {
            if (!household?.id) return;
            await assetOwnerProfiles.create(household.id, displayName);
            await loadOwnerProfiles();
          }}
          onRename={async (profile, displayName) => {
            if (!household?.id) return;
            await assetOwnerProfiles.rename(
              household.id,
              profile.profileId,
              displayName,
              profile.aggregateVersion
            );
            await loadOwnerProfiles();
          }}
        />

        <AssetEditModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setSelectedAsset(null);
          }}
          asset={selectedAsset}
        />

        <AssetHistoryModal
          isOpen={showHistoryModal}
          onClose={() => {
            setShowHistoryModal(false);
            setSelectedAsset(null);
          }}
          asset={selectedAsset}
          onEditAsset={handleEditAsset}
          onViewChart={handleViewChart}
        />

        <AssetBalanceChart
          isOpen={showChartModal}
          onClose={() => {
            setShowChartModal(false);
            setSelectedAsset(null);
          }}
          asset={selectedAsset}
          assets={assets}
        />
      </div>
    </main>
  );
}
