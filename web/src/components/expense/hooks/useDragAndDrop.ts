import { useState, useRef, useCallback } from 'react';
import { Expense } from '@/types/expense';

interface UseDragAndDropOptions {
  expenses: Expense[];
  onMergeExpenses?: (
    targetExpense: Expense,
    sourceExpense: Expense
  ) => void | Promise<void>;
  onMergeError?: (error: unknown) => void;
}

export function useDragAndDrop({
  expenses,
  onMergeExpenses,
  onMergeError,
}: UseDragAndDropOptions) {
  const [draggingExpenseId, setDraggingExpenseId] = useState<string | null>(null);
  const [dragOverExpenseId, setDragOverExpenseId] = useState<string | null>(null);
  const [isMergePending, setIsMergePending] = useState(false);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const mergeInFlightRef = useRef(false);

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

  const cancelTouchDrag = useCallback(() => {
    setDraggingExpenseId(null);
    setDragOverExpenseId(null);
  }, []);

  const requestMerge = useCallback(async (
    targetExpense: Expense,
    sourceExpense: Expense
  ): Promise<void> => {
    if (
      !onMergeExpenses
      || targetExpense.id === sourceExpense.id
      || mergeInFlightRef.current
    ) {
      return;
    }

    mergeInFlightRef.current = true;
    setIsMergePending(true);
    try {
      await onMergeExpenses(targetExpense, sourceExpense);
    } catch (error) {
      onMergeError?.(error);
    } finally {
      mergeInFlightRef.current = false;
      setIsMergePending(false);
    }
  }, [onMergeError, onMergeExpenses]);

  // 터치 드래그 종료 시 합치기
  const handleTouchDragEnd = useCallback(async (
    sourceId: string,
    targetId: string | null
  ): Promise<void> => {
    const sourceExpense = expenses.find((expense) => expense.id === sourceId);
    const targetExpense = targetId === null
      ? undefined
      : expenses.find((expense) => expense.id === targetId);
    cancelTouchDrag();
    if (sourceExpense && targetExpense) {
      await requestMerge(targetExpense, sourceExpense);
    }
  }, [cancelTouchDrag, expenses, requestMerge]);

  const registerItemRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) {
      itemRefs.current.set(id, element);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  return {
    draggingExpenseId,
    setDraggingExpenseId,
    dragOverExpenseId,
    setDragOverExpenseId,
    findItemAtPosition,
    handleTouchDragEnd,
    cancelTouchDrag,
    requestMerge,
    isMergePending,
    registerItemRef,
  };
}
