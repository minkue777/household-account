'use client';

import { Asset, AssetType, AssetHistoryEntry } from '@/types/asset';
import AssetCard from './AssetCard';
import { Plus } from 'lucide-react';

interface AssetListProps {
  assets: Asset[];
  selectedType: AssetType;
  historyMap: Record<string, AssetHistoryEntry[]>;
  onAssetClick: (asset: Asset) => void;
  onAddClick: () => void;
}

export default function AssetList({
  assets,
  selectedType,
  historyMap,
  onAssetClick,
  onAddClick,
}: AssetListProps) {
  // 선택된 타입의 자산만 필터링
  const filteredAssets = assets.filter((a) => a.type === selectedType && a.isActive);

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
    <div className="space-y-3">
      {filteredAssets.length === 0 ? (
        <div className="text-center py-12">
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
        <>
          {filteredAssets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              lastChange={getLastChange(asset.id)}
              onClick={() => onAssetClick(asset)}
            />
          ))}

          {/* 추가 버튼 */}
          <button
            onClick={onAddClick}
            className="w-full py-4 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:border-slate-300 hover:text-slate-500 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            자산 추가
          </button>
        </>
      )}
    </div>
  );
}
