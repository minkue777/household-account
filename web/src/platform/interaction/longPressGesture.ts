export const LONG_PRESS_DELAY_MS = 500;
export const LONG_PRESS_MOVE_TOLERANCE_PX = 16;
export const LONG_PRESS_CLICK_SUPPRESSION_MS = 500;

export interface GesturePoint {
  readonly x: number;
  readonly y: number;
}

export function movedBeyondLongPressTolerance(
  start: GesturePoint,
  current: GesturePoint
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y)
    > LONG_PRESS_MOVE_TOLERANCE_PX;
}

/**
 * A long press starts after the browser has already arbitrated the initial
 * touch. Install a non-passive listener synchronously at activation time so
 * the remainder of that gesture cannot turn into page scrolling.
 */
export function lockDocumentTouchScroll(): () => void {
  const previousBodyOverflow = document.body.style.overflow;
  const previousHtmlOverflow = document.documentElement.style.overflow;
  const preventScroll = (event: TouchEvent) => event.preventDefault();
  let released = false;

  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('touchmove', preventScroll, { passive: false });

  return () => {
    if (released) return;
    released = true;
    document.body.style.overflow = previousBodyOverflow;
    document.documentElement.style.overflow = previousHtmlOverflow;
    document.removeEventListener('touchmove', preventScroll);
  };
}
