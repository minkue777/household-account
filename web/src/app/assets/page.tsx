'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Asset, AssetType, AssetHistoryEntry } from '@/types/asset';
import {
  subscribeToAssets,
  subscribeToAssetHistory,
  getMonthlyAssetChange,
} from '@/lib/assetService';
import {
  AssetSummaryCard,
  AssetTypeSelector,
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
  const [selectedType, setSelectedType] = useState<AssetType>('bank');
  const [monthlyChange, setMonthlyChange] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // 각 자산의 이력 맵
  const [historyMap, setHistoryMap] = useState<Record<string, AssetHistoryEntry[]>>({});

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showChartModal, setShowChartModal] = useState(false);

  // 자산 구독
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeToAssets((newAssets) => {
      setAssets(newAssets);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 월별 변동액 조회
  useEffect(() => {
    getMonthlyAssetChange()
      .then(setMonthlyChange)
      .catch(() => setMonthlyChange(0));
  }, [assets]);

  // 각 자산의 이력 구독 (선택된 타입의 자산만)
  useEffect(() => {
    const filteredAssets = assets.filter((a) => a.type === selectedType && a.isActive);
    const unsubscribes: (() => void)[] = [];

    filteredAssets.forEach((asset) => {
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
  }, [assets, selectedType]);

  // 타입별 자산 수
  const assetCounts = useMemo(() => {
    const counts: Record<AssetType, number> = { bank: 0, investment: 0, property: 0 };
    assets.filter((a) => a.isActive).forEach((a) => {
      counts[a.type]++;
    });
    return counts;
  }, [assets]);

  // 자산 클릭 핸들러
  const handleAssetClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setShowHistoryModal(true);
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
      <div className="max-w-3xl mx-auto">
        {/* 헤더 */}
        <header className="mb-6 flex items-center gap-3">
          <Link
            href="/"
            className="p-2 hover:bg-white/80 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <h1
            className="text-xl md:text-2xl font-bold"
            style={{
              background: themeConfig.titleGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            자산 관리
          </h1>
        </header>

        {isLoading ? (
          <div className="text-center py-12 text-slate-400">로딩 중...</div>
        ) : (
          <div className="space-y-6">
            {/* 총 자산 요약 */}
            <AssetSummaryCard assets={assets} monthlyChange={monthlyChange} />

            {/* 타입 선택 탭 */}
            <AssetTypeSelector
              selectedType={selectedType}
              onTypeChange={setSelectedType}
              assetCounts={assetCounts}
            />

            {/* 자산 목록 */}
            <AssetList
              assets={assets}
              selectedType={selectedType}
              historyMap={historyMap}
              onAssetClick={handleAssetClick}
              onAddClick={() => setShowAddModal(true)}
            />
          </div>
        )}

        {/* 자산 추가 모달 */}
        <AssetAddModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          defaultType={selectedType}
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
