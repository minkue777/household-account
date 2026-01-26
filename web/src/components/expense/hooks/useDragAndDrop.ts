import { useState, useRef, useCallback, useEffect } from 'react';
import { Expense } from '@/types/expense';

interface UseDragAndDropOptions {
  expenses: Expense[];
  onMergeExpenses?: (targetExpense: Expense, sourceExpense: Expense) => void;
}

export function useDragAndDrop({ expenses, onMergeExpenses }: UseDragAndDropOptions) {
  const [draggingExpenseId, setDraggingExpenseId] = useState<string | null>(null);
  const [dragOverExpenseId, setDragOverExpenseId] = useState<string | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 터치 이동 중 어떤 항목 위에 있는지 확인
  const findItemAtPosition = useCallback((x: number, y: number): string | null => {
    const entries = Array.from(itemRefs.current.entries());
    for (let i = 0; i < entries.length; i++) {
      const [id, element] = entries[i];
      if (id === draggingExpenseId) continue;
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return id;
      }
    }
    return null;
  }, [draggingExpenseId]);

  // 터치 드래그 종료 시 합치기
  const handleTouchDragEnd = useCallback((sourceId: string, targetId: string | null) => {
    if (targetId && sourceId !== targetId && onMergeExpenses) {
      const sourceExpense = expenses.find(e => e.id === sourceId);
      const targetExpense = expenses.find(e => e.id === targetId);
      if (sourceExpense && targetExpense) {
        onMergeExpenses(targetExpense, sourceExpense);
      }
    }
    setDraggingExpenseId(null);
    setDragOverExpenseId(null);
  }, [expenses, onMergeExpenses]);

  const registerItemRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) {
      itemRefs.current.set(id, element);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  // 드래그 중일 때 스크롤 방지
  useEffect(() => {
    if (!draggingExpenseId) return;

    const preventScroll = (e: TouchEvent) => {
      e.preventDefault();
    };

    // 드래그 중일 때 body에 스크롤 방지
    document.body.style.overflow = 'hidden';
    document.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('touchmove', preventScroll);
    };
  }, [draggingExpenseId]);

  return {
    draggingExpenseId,
    setDraggingExpenseId,
    dragOverExpenseId,
    setDragOverExpenseId,
    findItemAtPosition,
    handleTouchDragEnd,
    registerItemRef,
  };
}
