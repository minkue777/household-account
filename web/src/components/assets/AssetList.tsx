'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Asset } from '@/types/asset';
import { updateAssetOrders } from '@/lib/assetService';
import AssetCard from './AssetCard';
import { Plus } from 'lucide-react';
import { useAppDialog } from '@/contexts/AppDialogContext';
import {
  lockDocumentTouchScroll,
  LONG_PRESS_CLICK_SUPPRESSION_MS,
  LONG_PRESS_DELAY_MS,
  movedBeyondLongPressTolerance,
  type GesturePoint,
} from '@/platform/interaction/longPressGesture';

interface AssetListProps {
  assets: Asset[];
  onAssetClick: (asset: Asset) => void;
  onAddClick: () => void;
}

export default function AssetList({
  assets,
  onAssetClick,
  onAddClick,
}: AssetListProps) {
  const { showAlert } = useAppDialog();
  // 활성 자산만 필터링, order 순 정렬
  const activeAssets = assets
    .filter((a) => a.isActive)
    .sort((a, b) => a.order - b.order);

  // 드래그 상태
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [touchGestureActive, setTouchGestureActive] = useState(false);

  interface TouchGesture {
    readonly sourceId: string;
    readonly start: GesturePoint;
    active: boolean;
    targetId: string | null;
  }

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickSuppressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchGesture = useRef<TouchGesture | null>(null);
  const releaseScrollLock = useRef<(() => void) | null>(null);
  const suppressNextClick = useRef(false);
  const reorderInFlightRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const clearClickSuppressionTimer = () => {
    if (clickSuppressionTimer.current) {
      clearTimeout(clickSuppressionTimer.current);
      clickSuppressionTimer.current = null;
    }
  };

  const releaseGestureResources = () => {
    clearLongPress();
    releaseScrollLock.current?.();
    releaseScrollLock.current = null;
    touchGesture.current = null;
    setTouchGestureActive(false);
  };

  const suppressFollowingClick = () => {
    suppressNextClick.current = true;
    clearClickSuppressionTimer();
    clickSuppressionTimer.current = setTimeout(() => {
      suppressNextClick.current = false;
      clickSuppressionTimer.current = null;
    }, LONG_PRESS_CLICK_SUPPRESSION_MS);
  };

  useEffect(() => () => {
    clearLongPress();
    clearClickSuppressionTimer();
    releaseScrollLock.current?.();
    releaseScrollLock.current = null;
  }, []);

  // 순서 변경 적용
  const applyReorder = useCallback(async (fromId: string, toId: string) => {
    if (fromId === toId || reorderInFlightRef.current) return;

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
      order: index,
    }));

    reorderInFlightRef.current = true;
    setIsReordering(true);
    try {
      await updateAssetOrders(updates);
    } catch (error) {
      console.error('순서 변경 오류:', error);
      void showAlert(
        '자산 순서를 변경하지 못했습니다. 다시 시도해 주세요.',
        '순서 변경 실패'
      );
    } finally {
      reorderInFlightRef.current = false;
      setIsReordering(false);
    }
  }, [activeAssets, showAlert]);

  // 데스크톱 드래그 시작
  const handleDragStart = (e: React.DragEvent, assetId: string) => {
    if (reorderInFlightRef.current || touchGesture.current !== null) {
      e.preventDefault();
      return;
    }
    setDraggedId(assetId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', assetId);
  };

  // 데스크톱 드래그 오버
  const handleDragOver = (e: React.DragEvent, assetId: string) => {
    if (reorderInFlightRef.current) return;
    e.preventDefault();
    if (draggedId && draggedId !== assetId) {
      setDragOverId(assetId);
    }
  };

  // 데스크톱 드래그 종료
  const handleDragEnd = () => {
    if (!reorderInFlightRef.current && draggedId && dragOverId) {
      void applyReorder(draggedId, dragOverId);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  // 모바일 터치 시작 (롱프레스 감지)
  const handleTouchStart = (e: React.TouchEvent, assetId: string) => {
    if (reorderInFlightRef.current || e.touches.length !== 1) return;
    clearLongPress();
    releaseScrollLock.current?.();
    releaseScrollLock.current = null;

    const touch = e.touches[0];
    const gesture: TouchGesture = {
      sourceId: assetId,
      start: { x: touch.clientX, y: touch.clientY },
      active: false,
      targetId: null,
    };
    touchGesture.current = gesture;
    setTouchGestureActive(true);

    longPressTimer.current = setTimeout(() => {
      if (reorderInFlightRef.current || touchGesture.current !== gesture) return;
      longPressTimer.current = null;
      gesture.active = true;
      releaseScrollLock.current = lockDocumentTouchScroll();
      suppressNextClick.current = true;
      setDraggedId(assetId);
      // 햅틱 피드백 (지원하는 경우)
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, LONG_PRESS_DELAY_MS);
  };

  // 모바일 터치 이동
  const handleTouchMove = (e: React.TouchEvent) => {
    const gesture = touchGesture.current;
    if (reorderInFlightRef.current || !gesture || e.touches.length !== 1) return;

    const touch = e.touches[0];
    if (!gesture.active) {
      if (movedBeyondLongPressTolerance(gesture.start, {
        x: touch.clientX,
        y: touch.clientY,
      })) {
        clearLongPress();
      }
      return;
    }

    e.preventDefault();

    const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
    let targetId: string | null = null;

    for (const el of elements) {
      const assetEl = el.closest('[data-asset-id]') as HTMLElement | null;
      if (assetEl && assetEl.dataset.assetId !== gesture.sourceId) {
        targetId = assetEl.dataset.assetId || null;
        break;
      }
    }
    gesture.targetId = targetId;
    setDragOverId(targetId);
  };

  // 모바일 터치 종료
  const handleTouchEnd = () => {
    const gesture = touchGesture.current;
    const activated = gesture?.active === true;
    const sourceId = gesture?.sourceId ?? null;
    const targetId = gesture?.targetId ?? null;
    releaseGestureResources();

    if (!reorderInFlightRef.current && activated && sourceId && targetId) {
      void applyReorder(sourceId, targetId);
    }

    if (activated) suppressFollowingClick();
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleTouchCancel = () => {
    const activated = touchGesture.current?.active === true;
    releaseGestureResources();
    if (activated) suppressFollowingClick();
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleAssetClick = (asset: Asset) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      clearClickSuppressionTimer();
      return;
    }
    onAssetClick(asset);
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
          aria-busy={isReordering}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
        >
          {activeAssets.map((asset) => {
            const isDragging = draggedId === asset.id;
            const isDragOver = dragOverId === asset.id;

            return (
              <div
                key={asset.id}
                data-asset-id={asset.id}
                draggable={!isReordering && !touchGestureActive}
                onDragStart={(e) => handleDragStart(e, asset.id)}
                onDragOver={(e) => handleDragOver(e, asset.id)}
                onDragEnd={handleDragEnd}
                onDragLeave={() => setDragOverId(null)}
                onTouchStart={(e) => handleTouchStart(e, asset.id)}
                onContextMenu={(event) => {
                  if (touchGesture.current !== null) event.preventDefault();
                }}
                className={`relative transition-all select-none ${
                  isDragging ? 'opacity-50 scale-95' : ''
                } ${isDragOver ? 'bg-blue-50' : ''}`}
                style={{ touchAction: 'pan-y' }}
              >
                {/* 드롭 인디케이터 */}
                {isDragOver && (
                  <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500" />
                )}

                {/* 자산 카드 */}
                <AssetCard
                  asset={asset}
                  onClick={() => handleAssetClick(asset)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
