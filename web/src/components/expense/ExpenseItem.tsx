'use client';

import { useState, useRef, useEffect } from 'react';
import { Expense, TransactionType } from '@/types/expense';
import { SplitItem } from '@/lib/expenseService';
import { notifyPartner } from '@/lib/partnerNotificationService';
import {
  runSplitMonthsAction,
  runCancelSplitGroupAction,
  runUpdateSplitGroupAction,
} from '@/lib/utils/monthlySplitActions';
import { getLedgerPrimaryText, getLedgerSecondaryText } from '@/lib/utils/ledgerDisplay';
import { useCategoryContext } from '@/contexts/CategoryContext';
import ExpenseEditModal from './ExpenseEditModal';
import ExpenseSplitModal from './ExpenseSplitModal';

interface ExpenseItemProps {
  expense: Expense;
  allExpenses: Expense[];
  onExpenseUpdate?: (
    expenseId: string,
    data: { amount?: number; memo?: string; category?: string; merchant?: string; date?: string }
  ) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onDelete?: (expenseId: string) => void;
  onSplitExpense?: (expense: Expense, splits: SplitItem[]) => void;
  onMergeExpenses?: (targetExpense: Expense, sourceExpense: Expense) => void;
  onUnmergeExpense?: (expense: Expense) => void;
  // 드래그 앤 드롭 props
  draggingExpenseId: string | null;
  setDraggingExpenseId: (id: string | null) => void;
  dragOverExpenseId: string | null;
  setDragOverExpenseId: (id: string | null) => void;
  findItemAtPosition: (x: number, y: number) => string | null;
  handleTouchDragEnd: (sourceId: string, targetId: string | null) => void;
  registerItemRef: (id: string, element: HTMLDivElement | null) => void;
  // 자동 편집 모달 열기
  autoEdit?: boolean;
  onAutoEditHandled?: () => void;
  transactionType: TransactionType;
}

export default function ExpenseItem({
  expense,
  allExpenses,
  onExpenseUpdate,
  onSaveMerchantRule,
  onDelete,
  onSplitExpense,
  onMergeExpenses,
  onUnmergeExpense,
  draggingExpenseId,
  setDraggingExpenseId,
  dragOverExpenseId,
  setDragOverExpenseId,
  findItemAtPosition,
  handleTouchDragEnd,
  registerItemRef,
  autoEdit,
  onAutoEditHandled,
  transactionType,
}: ExpenseItemProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();

  const [showEditModal, setShowEditModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
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

  // 자동 편집 모달 열기 (푸시 알림 클릭 시)
  useEffect(() => {
    if (autoEdit && !showEditModal) {
      setShowEditModal(true);
      onAutoEditHandled?.();
    }
  }, [autoEdit, showEditModal, onAutoEditHandled]);

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

  const handleSaveEdit = (
    updates: { amount?: number; memo?: string; category?: string; merchant?: string; date?: string }
  ) => {
    if (onExpenseUpdate && Object.keys(updates).length > 0) {
      onExpenseUpdate(expense.id, updates);
    }
  };

  const handleSplitExpense = (splits: SplitItem[]) => {
    if (onSplitExpense) {
      onSplitExpense(expense, splits);
    }
  };

  // 월별 분할 처리 (여러 달에 걸쳐 분할)
  const handleSplitMonths = async (months: number) => {
    if (!onDelete) return;
    await runSplitMonthsAction({
      expense,
      months,
      deleteExpense: onDelete,
    });
  };

  // 월별 분할 취소 (합치기)
  const handleCancelSplitGroup = async () => {
    await runCancelSplitGroupAction({ expense });
  };

  // 월별 분할 그룹 개월 수 변경
  const handleUpdateSplitGroup = async (newMonths: number) => {
    await runUpdateSplitGroupAction({ expense, newMonths });
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
        onClick={isDragging ? undefined : () => setShowEditModal(true)}
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

      {/* 편집 모달 */}
      <ExpenseEditModal
        expense={expense}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        transactionType={transactionType}
        onSave={handleSaveEdit}
        onSaveMerchantRule={onSaveMerchantRule}
        onUnmerge={onUnmergeExpense ? () => onUnmergeExpense(expense) : undefined}
        onOpenSplit={transactionType === 'expense' && onSplitExpense ? () => setShowSplitModal(true) : undefined}
        onSplitMonths={transactionType === 'expense' && onDelete ? handleSplitMonths : undefined}
        onCancelSplitGroup={transactionType === 'expense' && expense.splitGroupId ? handleCancelSplitGroup : undefined}
        onUpdateSplitGroup={transactionType === 'expense' && expense.splitGroupId ? handleUpdateSplitGroup : undefined}
        onDelete={onDelete ? () => onDelete(expense.id) : undefined}
        onNotifyPartner={transactionType === 'expense' ? () => notifyPartner(expense.id) : undefined}
      />

      {/* 분할 모달 */}
      <ExpenseSplitModal
        expense={expense}
        isOpen={showSplitModal}
        onClose={() => setShowSplitModal(false)}
        onSave={handleSplitExpense}
      />
    </div>
  );
}
