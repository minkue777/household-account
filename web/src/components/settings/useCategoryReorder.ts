'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { CategoryDocument } from '@/types/category';

type Drag = {
  id: string;
  pointerId: number;
  startY: number;
  startScrollY: number;
  clientY: number;
  targetId: string;
  rows: { id: string; centerY: number }[];
};

export function useCategoryReorder(
  categories: CategoryDocument[],
  disabled: boolean,
  onReorder: (categories: CategoryDocument[]) => Promise<void>
) {
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ id: string; targetId: string; offsetY: number } | null>(null);

  const cancel = useCallback(() => {
    dragRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setPreview(null);
  }, []);

  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const updatePreview = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const source = drag.rows.find((row) => row.id === drag.id)!;
    const offsetY = Math.max(
      drag.rows[0].centerY - source.centerY,
      Math.min(
        drag.rows[drag.rows.length - 1].centerY - source.centerY,
        drag.clientY - drag.startY + window.scrollY - drag.startScrollY
      )
    );
    const centerY = source.centerY + offsetY;
    const target = drag.rows.reduce((nearest, row) =>
      Math.abs(row.centerY - centerY) < Math.abs(nearest.centerY - centerY) ? row : nearest
    );
    drag.targetId = target.id;
    setPreview({ id: drag.id, targetId: target.id, offsetY });
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (disabled || dragRef.current || !event.isPrimary || event.button !== 0) return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-category-id]') ?? [])
      .map((row) => {
        const rect = row.getBoundingClientRect();
        return { id: row.dataset.categoryId!, centerY: rect.top + rect.height / 2 + window.scrollY };
      });
    if (!rows.length) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id, pointerId: event.pointerId, startY: event.clientY,
      startScrollY: window.scrollY, clientY: event.clientY, targetId: id, rows,
    };
    setPreview({ id, targetId: id, offsetY: 0 });

    // 화면 밖 항목도 같은 드래그로 옮길 수 있도록 가장자리에서만 스크롤합니다.
    let lastFrameTime: number | null = null;
    const scroll = (time: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const elapsed = lastFrameTime === null ? 0 : Math.min(time - lastFrameTime, 32);
      lastFrameTime = time;
      const edge = 64;
      const speed = drag.clientY < edge
        ? -Math.min(1, (edge - drag.clientY) / edge)
        : drag.clientY > window.innerHeight - edge
          ? Math.min(1, (drag.clientY - window.innerHeight + edge) / edge)
          : 0;
      if (speed !== 0) {
        window.scrollBy(0, speed * elapsed * 0.5);
        updatePreview();
      }
      frameRef.current = requestAnimationFrame(scroll);
    };
    frameRef.current = requestAnimationFrame(scroll);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current.clientY = event.clientY;
    updatePreview();
  };

  const move = async (id: string, targetId: string) => {
    if (disabled || id === targetId) return;
    const from = categories.findIndex((category) => category.id === id);
    const to = categories.findIndex((category) => category.id === targetId);
    if (from < 0 || to < 0) return;
    const reordered = [...categories];
    reordered.splice(to, 0, reordered.splice(from, 1)[0]);
    await onReorder(reordered);
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.clientY = event.clientY;
    updatePreview();
    cancel();
    void move(drag.id, drag.targetId);
  };

  const moveByKeyboard = (id: string, direction: number) => {
    const index = categories.findIndex((category) => category.id === id);
    const target = categories[index + direction];
    if (target) void move(id, target.id);
  };

  return { listRef, preview, onPointerDown, onPointerMove, onPointerUp, cancel, moveByKeyboard };
}
