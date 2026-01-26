'use client';

import { useState, useRef, useEffect } from 'react';
import { Expense } from '@/types/expense';
import { SplitItem, addExpense, generateSplitGroupId, deleteSplitGroup, updateSplitGroup } from '@/lib/expenseService';
import { useCategoryContext } from '@/contexts/CategoryContext';
import ExpenseEditModal from './ExpenseEditModal';
import ExpenseSplitModal from './ExpenseSplitModal';
import { ConfirmDialog } from '../common';

interface ExpenseItemProps {
  expense: Expense;
  allExpenses: Expense[];
  onExpenseUpdate?: (expenseId: string, data: { amount?: number; memo?: string; category?: string; merchant?: string }) => void;
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
}: ExpenseItemProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();

  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // 터치 드래그 상태
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isDragging = draggingExpenseId === expense.id;
  const isDropTarget = dragOverExpenseId === expense.id && draggingExpenseId !== expense.id;

  const expenseColor = getCategoryColor(expense.category);
  const expenseLabel = getCategoryLabel(expense.category);

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

  const handleSaveEdit = (updates: { amount?: number; memo?: string; category?: string; merchant?: string }) => {
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

    const monthlyAmount = Math.floor(expense.amount / months);
    const baseDate = new Date(expense.date);
    const splitGroupId = generateSplitGroupId();

    try {
      // 분할된 지출 생성 (그룹 ID로 연결)
      for (let i = 0; i < months; i++) {
        const targetDate = new Date(baseDate);
        targetDate.setMonth(targetDate.getMonth() + i);
        const dateStr = targetDate.toISOString().split('T')[0];

        await addExpense({
          date: dateStr,
          time: expense.time || '09:00',
          merchant: expense.merchant,
          amount: monthlyAmount,
          category: expense.category,
          memo: `(${i + 1}/${months})`,
          cardType: expense.cardType || 'main',
          splitGroupId,
          splitIndex: i + 1,
          splitTotal: months,
        });
      }

      // 기존 지출 삭제
      onDelete(expense.id);
    } catch (error) {
      console.error('월별 분할 처리 실패:', error);
      alert('분할 처리 중 오류가 발생했습니다.');
    }
  };

  // 월별 분할 그룹 전체 삭제
  const handleDeleteSplitGroup = async () => {
    if (!expense.splitGroupId) return;

    try {
      await deleteSplitGroup(expense.splitGroupId);
    } catch (error) {
      console.error('분할 그룹 삭제 실패:', error);
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  // 월별 분할 그룹 개월 수 변경
  const handleUpdateSplitGroup = async (newMonths: number) => {
    if (!expense.splitGroupId) return;

    try {
      await updateSplitGroup(expense.splitGroupId, newMonths);
    } catch (error) {
      console.error('분할 그룹 수정 실패:', error);
      alert('수정 중 오류가 발생했습니다.');
    }
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
            style={{ backgroundColor: expenseColor }}
          >
            {expenseLabel.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-slate-800 truncate">
              {expense.merchant}
            </div>
            {expense.memo && (
              <div className="text-xs text-slate-500 truncate">
                {expense.memo}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <div className="font-semibold text-slate-800">
            {expense.amount.toLocaleString()}원
          </div>
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteDialog(true);
              }}
              className="p-1 text-slate-400 hover:text-red-500 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 편집 모달 */}
      <ExpenseEditModal
        expense={expense}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={handleSaveEdit}
        onSaveMerchantRule={onSaveMerchantRule}
        onUnmerge={onUnmergeExpense ? () => onUnmergeExpense(expense) : undefined}
        onOpenSplit={onSplitExpense ? () => setShowSplitModal(true) : undefined}
        onSplitMonths={onDelete ? handleSplitMonths : undefined}
        onDeleteSplitGroup={expense.splitGroupId ? handleDeleteSplitGroup : undefined}
        onUpdateSplitGroup={expense.splitGroupId ? handleUpdateSplitGroup : undefined}
      />

      {/* 삭제 확인 다이얼로그 */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        title="삭제 확인"
        message={`"${expense.merchant}" ${expense.amount.toLocaleString()}원을 삭제하시겠습니까?`}
        confirmLabel="삭제"
        variant="danger"
        onConfirm={() => {
          if (onDelete) {
            onDelete(expense.id);
          }
          setShowDeleteDialog(false);
        }}
        onCancel={() => setShowDeleteDialog(false)}
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
