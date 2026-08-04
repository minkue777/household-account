'use client';

import { useEffect, useRef, useState } from 'react';
import type { Expense, TransactionType } from '@/types/expense';
import { getLedgerPrimaryText, getLedgerSecondaryText } from '@/lib/utils/ledgerDisplay';
import { useCategoryContext } from '@/contexts/CategoryContext';
import {
  lockDocumentTouchScroll,
  LONG_PRESS_CLICK_SUPPRESSION_MS,
  LONG_PRESS_DELAY_MS,
  movedBeyondLongPressTolerance,
  type GesturePoint,
} from '@/platform/interaction/longPressGesture';

interface ExpenseItemProps {
  expense: Expense;
  allExpenses: Expense[];
  onEdit: (expense: Expense) => void;
  onMergeExpenses?: (
    targetExpense: Expense,
    sourceExpense: Expense
  ) => void | Promise<void>;
  // 드래그 앤 드롭 props
  draggingExpenseId: string | null;
  setDraggingExpenseId: (id: string | null) => void;
  dragOverExpenseId: string | null;
  setDragOverExpenseId: (id: string | null) => void;
  findItemAtPosition: (x: number, y: number) => string | null;
  handleTouchDragEnd: (
    sourceId: string,
    targetId: string | null
  ) => Promise<void>;
  cancelTouchDrag: () => void;
  mergeDisabled: boolean;
  registerItemRef: (id: string, element: HTMLDivElement | null) => void;
  transactionType: TransactionType;
}

export default function ExpenseItem({
  expense,
  allExpenses,
  onEdit,
  onMergeExpenses,
  draggingExpenseId,
  setDraggingExpenseId,
  dragOverExpenseId,
  setDragOverExpenseId,
  findItemAtPosition,
  handleTouchDragEnd,
  cancelTouchDrag,
  mergeDisabled,
  registerItemRef,
  transactionType,
}: ExpenseItemProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();

  const [isDragOver, setIsDragOver] = useState(false);
  const [touchGestureActive, setTouchGestureActive] = useState(false);

  interface TouchGesture {
    readonly start: GesturePoint;
    active: boolean;
    targetId: string | null;
  }

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickSuppressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchGesture = useRef<TouchGesture | null>(null);
  const releaseScrollLock = useRef<(() => void) | null>(null);
  const suppressNextClick = useRef(false);
  const isDragging = draggingExpenseId === expense.id;
  const isDropTarget = dragOverExpenseId === expense.id && draggingExpenseId !== expense.id;

  const expenseColor = getCategoryColor(expense.category);
  const expenseLabel = getCategoryLabel(expense.category);
  const primaryText = getLedgerPrimaryText(expense, transactionType);
  const secondaryText = getLedgerSecondaryText(expense, transactionType);

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

  // 데스크톱 드래그 앤 드롭 핸들러
  const handleDragStart = (e: React.DragEvent) => {
    if (mergeDisabled || touchGesture.current !== null) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('expense-id', expense.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.types.includes('expense-id');
    if (draggedId) {
      setIsDragOver(true);
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (mergeDisabled) return;
    const sourceId = e.dataTransfer.getData('expense-id');

    if (sourceId && sourceId !== expense.id && onMergeExpenses) {
      const sourceExpense = allExpenses.find((exp) => exp.id === sourceId);
      if (sourceExpense) {
        try {
          await onMergeExpenses(expense, sourceExpense);
        } catch {
          // 상위 merge coordinator가 실패 안내와 rollback을 담당합니다.
        }
      }
    }
  };

  // 모바일 터치 핸들러
  const handleTouchStart = (e: React.TouchEvent) => {
    if (mergeDisabled || e.touches.length !== 1) return;
    clearLongPress();
    releaseScrollLock.current?.();
    releaseScrollLock.current = null;

    const touch = e.touches[0];
    const gesture: TouchGesture = {
      start: { x: touch.clientX, y: touch.clientY },
      active: false,
      targetId: null,
    };
    touchGesture.current = gesture;
    setTouchGestureActive(true);

    longPressTimer.current = setTimeout(() => {
      if (touchGesture.current !== gesture) return;
      longPressTimer.current = null;
      gesture.active = true;
      releaseScrollLock.current = lockDocumentTouchScroll();
      suppressNextClick.current = true;
      setDraggingExpenseId(expense.id);
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, LONG_PRESS_DELAY_MS);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const gesture = touchGesture.current;
    if (!gesture || e.touches.length !== 1) return;

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
    const candidateId = findItemAtPosition(touch.clientX, touch.clientY);
    const targetId = candidateId === expense.id ? null : candidateId;
    gesture.targetId = targetId;
    setDragOverExpenseId(targetId);
  };

  const handleTouchEnd = async () => {
    const gesture = touchGesture.current;
    const activated = gesture?.active === true;
    const targetId = gesture?.targetId ?? null;
    releaseGestureResources();

    if (activated) {
      suppressFollowingClick();
      try {
        await handleTouchDragEnd(expense.id, targetId);
      } catch {
        cancelTouchDrag();
      }
    }
  };

  const handleTouchCancel = () => {
    const activated = touchGesture.current?.active === true;
    releaseGestureResources();
    if (activated) suppressFollowingClick();
    cancelTouchDrag();
  };

  const handleClick = (event: React.MouseEvent) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      clearClickSuppressionTimer();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onEdit(expense);
  };

  return (
    <div className="relative" ref={(el) => registerItemRef(expense.id, el)}>
      <div
        data-testid="expense-item"
        draggable={!mergeDisabled && !touchGestureActive}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onClick={handleClick}
        onContextMenu={(event) => {
          if (touchGesture.current !== null) event.preventDefault();
        }}
        style={{ touchAction: isDragging || draggingExpenseId ? 'none' : 'pan-y' }}
        className={`flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer select-none ${
          isDragging
            ? 'bg-blue-200 border-2 border-blue-500 scale-105 shadow-lg opacity-90'
            : isDropTarget || isDragOver
            ? 'bg-blue-100 border-2 border-blue-400 border-dashed'
            : 'bg-slate-50 hover:bg-slate-100'
        }`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
            style={{ backgroundColor: transactionType === 'income' ? '#10B981' : expenseColor }}
          >
            {transactionType === 'income' ? '수입' : expenseLabel.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-slate-800 truncate">
              {primaryText}
            </div>
            {secondaryText && (
              <div className="text-xs text-slate-500 truncate">
                {secondaryText}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <div className="font-semibold text-slate-800">
            {expense.amount.toLocaleString()}원
          </div>
        </div>
      </div>

    </div>
  );
}
