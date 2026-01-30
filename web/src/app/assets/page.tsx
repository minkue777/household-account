'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Asset, AssetType, AssetHistoryEntry, FAMILY_MEMBERS } from '@/types/asset';
import {
  subscribeToAssets,
  subscribeToAssetHistory,
  getMonthlyAssetChange,
  saveMonthlySnapshot,
  addSampleAssets,
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

export default function AssetsPage() {
  const { themeConfig } = useTheme();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [monthlyChange, setMonthlyChange] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // 각 자산의 이력 맵
  const [historyMap, setHistoryMap] = useState<Record<string, AssetHistoryEntry[]>>({});

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalType, setAddModalType] = useState<AssetType>('savings');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showChartModal, setShowChartModal] = useState(false);
  const [isAddingSample, setIsAddingSample] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string>('전체');

  // 샘플 데이터 추가
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

  // 자산 구독
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeToAssets((newAssets) => {
      setAssets(newAssets);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 월별 변동액 조회 및 스냅샷 저장
  useEffect(() => {
    if (assets.length === 0) return;

    const activeAssets = assets.filter((a) => a.isActive);
    const currentTotal = activeAssets.reduce((sum, a) => sum + a.currentBalance, 0);

    // 전월 대비 변동액 계산
    getMonthlyAssetChange(currentTotal)
      .then(setMonthlyChange)
      .catch(() => setMonthlyChange(0));

    // 이번 달 스냅샷 저장 (현재 총자산)
    saveMonthlySnapshot(currentTotal);
  }, [assets]);

  // 각 자산의 이력 구독
  useEffect(() => {
    const activeAssets = assets.filter((a) => a.isActive);
    const unsubscribes: (() => void)[] = [];

    activeAssets.forEach((asset) => {
      const unsub = subscribeToAssetHistory(asset.id, (history) => {
        setHistoryMap((prev) => ({
          ...prev,
          [asset.id]: history,
        }));
      });
      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [assets]);

  // 자산 클릭 핸들러
  const handleAssetClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setShowHistoryModal(true);
  };

  // 자산 추가 열기
  const handleAddClick = () => {
    setAddModalType('savings');
    setShowAddModal(true);
  };

  // 자산 수정 열기
  const handleEditAsset = () => {
    setShowHistoryModal(false);
    setShowEditModal(true);
  };

  // 차트 보기
  const handleViewChart = () => {
    setShowHistoryModal(false);
    setShowChartModal(true);
  };

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-lg mx-auto">
        {/* 헤더 */}
        <header className="mb-6 flex items-center justify-between">
          {/* 제목 + 곰돌이 (클릭 시 가계부 페이지로 이동) */}
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer">
            <h1
              className="text-lg md:text-2xl font-bold leading-tight"
              style={{
                background: themeConfig.titleGradient,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              또니망고네
              <br />
              자산
            </h1>
            <img
              src="/bear-removebg-preview.png"
              alt="곰돌이"
              className="w-14 h-14 md:w-16 md:h-16 object-contain"
            />
          </Link>
          {/* 우측 버튼들 */}
          <div className="flex items-center gap-2">
            {/* 샘플 데이터 추가 버튼 (자산이 없을 때만) */}
            {!isLoading && assets.length === 0 && (
              <button
                onClick={handleAddSampleData}
                disabled={isAddingSample}
                className="text-sm text-blue-500 hover:text-blue-600 disabled:text-slate-400"
              >
                {isAddingSample ? '추가 중...' : '샘플 데이터'}
              </button>
            )}
            {/* 통계 버튼 */}
            <Link
              href="/assets/stats"
              className="p-2 bg-white/80 hover:bg-white rounded-xl transition-all shadow-sm hover:shadow border border-slate-200/50"
            >
              <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </Link>
          </div>
        </header>

        {isLoading ? (
          <div className="text-center py-12 text-slate-400">로딩 중...</div>
        ) : (
          <div className="space-y-4">
            {/* 가족 탭 + 총 자산 요약 + 도넛 차트 */}
            <AssetSummaryCard
              assets={assets}
              monthlyChange={monthlyChange}
              selectedMember={selectedMember}
              onMemberChange={setSelectedMember}
            />

            {/* 보유 현황 */}
            <AssetList
              assets={selectedMember === '전체' ? assets : assets.filter(a => a.owner === selectedMember)}
              historyMap={historyMap}
              onAssetClick={handleAssetClick}
              onAddClick={handleAddClick}
            />
          </div>
        )}

        {/* 자산 추가 모달 */}
        <AssetAddModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          defaultType={addModalType}
          defaultOwner={selectedMember}
        />

        {/* 자산 수정 모달 */}
        <AssetEditModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setSelectedAsset(null);
          }}
          asset={selectedAsset}
        />

        {/* 자산 이력 모달 */}
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

        {/* 잔액 차트 모달 */}
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
