'use client';

import { useRef, useState } from 'react';
import type { Expense, TransactionType } from '@/types/expense';
import { getLedgerPrimaryText, getLedgerSecondaryText } from '@/lib/utils/ledgerDisplay';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface ExpenseItemProps {
  expense: Expense;
  allExpenses: Expense[];
  onEdit: (expense: Expense) => void;
  onMergeExpenses?: (targetExpense: Expense, sourceExpense: Expense) => void;
  // 드래그 앤 드롭 props
  draggingExpenseId: string | null;
  setDraggingExpenseId: (id: string | null) => void;
  dragOverExpenseId: string | null;
  setDragOverExpenseId: (id: string | null) => void;
  findItemAtPosition: (x: number, y: number) => string | null;
  handleTouchDragEnd: (sourceId: string, targetId: string | null) => void;
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
  registerItemRef,
  transactionType,
}: ExpenseItemProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();

  const [isDragOver, setIsDragOver] = useState(false);

  // 터치 드래그 상태
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isDragging = draggingExpenseId === expense.id;
  const isDropTarget = dragOverExpenseId === expense.id && draggingExpenseId !== expense.id;

  const expenseColor = getCategoryColor(expense.category);
  const expenseLabel = getCategoryLabel(expense.category);
  const primaryText = getLedgerPrimaryText(expense, transactionType);
  const secondaryText = getLedgerSecondaryText(expense, transactionType);

  // 데스크톱 드래그 앤 드롭 핸들러
  const handleDragStart = (e: React.DragEvent) => {
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const sourceId = e.dataTransfer.getData('expense-id');

    if (sourceId && sourceId !== expense.id && onMergeExpenses) {
      const sourceExpense = allExpenses.find((exp) => exp.id === sourceId);
      if (sourceExpense) {
        onMergeExpenses(expense, sourceExpense);
      }
    }
  };

  // 모바일 터치 핸들러
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };

    longPressTimer.current = setTimeout(() => {
      setDraggingExpenseId(expense.id);
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos.current) return;

    const touch = e.touches[0];
    const moveX = Math.abs(touch.clientX - touchStartPos.current.x);
    const moveY = Math.abs(touch.clientY - touchStartPos.current.y);

    if (!isDragging && (moveX > 10 || moveY > 10)) {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }

    if (isDragging) {
      e.preventDefault();
      const targetId = findItemAtPosition(touch.clientX, touch.clientY);
      setDragOverExpenseId(targetId);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (isDragging) {
      handleTouchDragEnd(expense.id, dragOverExpenseId);
    }

    touchStartPos.current = null;
  };

  return (
    <div className="relative" ref={(el) => registerItemRef(expense.id, el)}>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={isDragging ? undefined : () => onEdit(expense)}
        style={{ touchAction: isDragging || draggingExpenseId ? 'none' : 'auto' }}
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
