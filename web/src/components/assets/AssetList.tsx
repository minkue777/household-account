'use client';

import { useState, useRef, useCallback } from 'react';
import { Asset, AssetHistoryEntry } from '@/types/asset';
import { updateAssetOrders } from '@/lib/assetService';
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

  // 드래그 상태
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isLongPress, setIsLongPress] = useState(false);

  // 롱프레스 타이머
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartY = useRef<number>(0);
  const draggedElement = useRef<HTMLDivElement | null>(null);

  // 각 자산의 마지막 변동 가져오기
  const getLastChange = (assetId: string) => {
    const history = historyMap[assetId];
    if (!history || history.length === 0) return undefined;
    const last = history[0];
    return {
      amount: last.changeAmount,
      date: last.date,
    };
  };

  // 순서 변경 적용
  const applyReorder = useCallback(async (fromId: string, toId: string) => {
    if (fromId === toId) return;

    const fromIndex = activeAssets.findIndex((a) => a.id === fromId);
    const toIndex = activeAssets.findIndex((a) => a.id === toId);

    if (fromIndex === -1 || toIndex === -1) return;

    // 새 순서 배열 생성 (insert sort 방식)
    const newOrder = [...activeAssets];
    const [movedItem] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, movedItem);

    // order 값 재계산
    const updates = newOrder.map((asset, index) => ({
      id: asset.id,
      order: index * 1000, // 간격을 두어 나중에 중간 삽입 가능하도록
    }));

    try {
      await updateAssetOrders(updates);
    } catch (error) {
      console.error('순서 변경 오류:', error);
    }
  }, [activeAssets]);

  // 데스크톱 드래그 시작
  const handleDragStart = (e: React.DragEvent, assetId: string) => {
    setDraggedId(assetId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', assetId);
  };

  // 데스크톱 드래그 오버
  const handleDragOver = (e: React.DragEvent, assetId: string) => {
    e.preventDefault();
    if (draggedId && draggedId !== assetId) {
      setDragOverId(assetId);
    }
  };

  // 데스크톱 드래그 종료
  const handleDragEnd = () => {
    if (draggedId && dragOverId) {
      applyReorder(draggedId, dragOverId);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  // 모바일 터치 시작 (롱프레스 감지)
  const handleTouchStart = (e: React.TouchEvent, assetId: string) => {
    touchStartY.current = e.touches[0].clientY;

    longPressTimer.current = setTimeout(() => {
      setIsLongPress(true);
      setDraggedId(assetId);
      // 햅틱 피드백 (지원하는 경우)
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 500); // 500ms 롱프레스
  };

  // 모바일 터치 이동
  const handleTouchMove = (e: React.TouchEvent) => {
    // 롱프레스 전 움직임 - 롱프레스 취소
    if (!isLongPress && longPressTimer.current) {
      const moveY = Math.abs(e.touches[0].clientY - touchStartY.current);
      if (moveY > 10) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      return;
    }

    if (!isLongPress || !draggedId) return;

    e.preventDefault();

    // 현재 터치 위치에서 어떤 요소 위에 있는지 확인
    const touch = e.touches[0];
    const elements = document.elementsFromPoint(touch.clientX, touch.clientY);

    for (const el of elements) {
      const assetEl = el.closest('[data-asset-id]') as HTMLElement;
      if (assetEl && assetEl.dataset.assetId !== draggedId) {
        setDragOverId(assetEl.dataset.assetId || null);
        break;
      }
    }
  };

  // 모바일 터치 종료
  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (isLongPress && draggedId && dragOverId) {
      applyReorder(draggedId, dragOverId);
    }

    setIsLongPress(false);
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2 px-2">
        <h3 className="font-semibold text-slate-800">보유 현황</h3>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          추가
        </button>
      </div>

      {/* 구분선 */}
      <div className="border-b border-slate-100 mb-2" />

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
        <div
          className="divide-y divide-slate-50"
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {activeAssets.map((asset) => {
            const isDragging = draggedId === asset.id;
            const isDragOver = dragOverId === asset.id;

            return (
              <div
                key={asset.id}
                data-asset-id={asset.id}
                draggable
                onDragStart={(e) => handleDragStart(e, asset.id)}
                onDragOver={(e) => handleDragOver(e, asset.id)}
                onDragEnd={handleDragEnd}
                onDragLeave={() => setDragOverId(null)}
                onTouchStart={(e) => handleTouchStart(e, asset.id)}
                className={`relative transition-all cursor-grab active:cursor-grabbing ${
                  isDragging ? 'opacity-50 scale-95' : ''
                } ${isDragOver ? 'bg-blue-50' : ''}`}
              >
                {/* 드롭 인디케이터 */}
                {isDragOver && (
                  <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500" />
                )}

                {/* 자산 카드 */}
                <AssetCard
                  asset={asset}
                  lastChange={getLastChange(asset.id)}
                  onClick={() => !isLongPress && onAssetClick(asset)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
