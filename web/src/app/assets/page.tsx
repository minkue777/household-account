'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Asset, AssetType } from '@/types/asset';
import {
  subscribeToAssets,
  getDailyAssetChange,
  saveDailyTotalSnapshot,
  addSampleAssets,
  refreshAllStockPrices,
} from '@/lib/assetService';
import {
  AssetSummaryCard,
  AssetList,
  AssetAddModal,
  AssetEditModal,
  AssetHistoryModal,
  AssetBalanceChart,
} from '@/components/assets';
import { useTheme } from '@/contexts/ThemeContext';
import { useHousehold } from '@/contexts/HouseholdContext';
import {
  ALL_MEMBERS_OPTION,
  getAssetMemberOptions,
  getAssetOwnerOptions,
} from '@/lib/assets/memberOptions';

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
  const [isAddingSample, setIsAddingSample] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string>(ALL_MEMBERS_OPTION);

  const memberNames = useMemo(
    () => household?.members.map((member) => member.name) ?? [],
    [household?.members]
  );
  const memberOptions = useMemo(() => getAssetMemberOptions(memberNames), [memberNames]);
  const ownerOptions = useMemo(() => getAssetOwnerOptions(memberNames), [memberNames]);

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
    refreshAllStockPrices().catch(console.error);
  }, []);

  useEffect(() => {
    if (!memberOptions.includes(selectedMember)) {
      setSelectedMember(ALL_MEMBERS_OPTION);
    }
  }, [memberOptions, selectedMember]);

  useEffect(() => {
    if (assets.length === 0) return;

    const activeAssets = assets.filter((asset) => asset.isActive);
    const currentTotal = activeAssets.reduce((sum, asset) => sum + asset.currentBalance, 0);
    const financialTotal = activeAssets
      .filter((asset) => asset.type !== 'property')
      .reduce((sum, asset) => sum + asset.currentBalance, 0);

    getDailyAssetChange()
      .then(setDailyChange)
      .catch(() => setDailyChange(0));

    saveDailyTotalSnapshot(currentTotal, financialTotal);
  }, [assets]);

  const handleAssetClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setShowHistoryModal(true);
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
      : assets.filter((asset) => asset.owner === selectedMember);

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-lg">
        <header className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="flex cursor-pointer items-center gap-2 transition-opacity hover:opacity-80"
          >
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
            <img
              src="/lupy.png"
              alt="루피"
              className="h-16 w-16 object-contain md:h-[4.5rem] md:w-[4.5rem]"
            />
          </Link>

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
              <svg
                className="h-5 w-5 text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
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
          defaultOwner={selectedMember}
          ownerOptions={ownerOptions}
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
