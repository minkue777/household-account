'use client';

import { Asset, AssetHistoryEntry } from '@/types/asset';
import AssetCard from './AssetCard';
import { Plus } from 'lucide-react';

interface AssetListProps {
  assets: Asset[];
  historyMap: Record<string, AssetHistoryEntry[]>;
  onAssetClick: (asset: Asset) => void;
  onAddClick: () => void;
}

export default function AssetList({
  assets,
  historyMap,
  onAssetClick,
  onAddClick,
}: AssetListProps) {
  // 활성 자산만 필터링, order 순 정렬
  const activeAssets = assets
    .filter((a) => a.isActive)
    .sort((a, b) => a.order - b.order);

  // 각 자산의 마지막 변동 가져오기
  const getLastChange = (assetId: string) => {
    const history = historyMap[assetId];
    if (!history || history.length === 0) return undefined;
    const last = history[0]; // 이미 날짜 내림차순 정렬됨
    return {
      amount: last.changeAmount,
      date: last.date,
    };
  };

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4 px-1">
        <h3 className="font-semibold text-slate-800">보유 현황</h3>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          추가
        </button>
      </div>

      {/* 자산 목록 */}
      {activeAssets.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-slate-400 mb-4">등록된 자산이 없습니다.</p>
          <button
            onClick={onAddClick}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            자산 추가
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {activeAssets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              lastChange={getLastChange(asset.id)}
              onClick={() => onAssetClick(asset)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
