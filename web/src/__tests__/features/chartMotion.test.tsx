import { act, renderHook } from '@testing-library/react';
import { useChartMotion } from '@/components/common/useChartMotion';

const originalMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMatchMedia; });

it('uses a short product transition and keeps options stable without a preference change', () => {
  const { result, rerender } = renderHook(useChartMotion);
  const initial = result.current;
  expect(initial.animation).toEqual({ duration: 150 });
  expect(initial.transitions.active.animation.duration).toBe(150);
  rerender();
  expect(result.current).toBe(initial);
});

it('honors reduced motion on the first render, follows OS changes and removes the listener on unmount', () => {
  let reducedMotion = true;
  const listeners = new Set<() => void>();
  const removeEventListener = jest.fn((_type: string, listener: () => void) => { listeners.delete(listener); });
  const media = {
    get matches() { return reducedMotion; },
    addEventListener: jest.fn((_type: string, listener: () => void) => { listeners.add(listener); }),
    removeEventListener,
  };
  window.matchMedia = jest.fn(() => media as unknown as MediaQueryList);
  const { result, unmount } = renderHook(useChartMotion);
  expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  expect(result.current.animation).toBe(false);
  expect(result.current.transitions.active.animation.duration).toBe(0);
  act(() => { reducedMotion = false; listeners.forEach(listener => listener()); });
  expect(result.current.animation).toEqual({ duration: 150 });
  act(() => { reducedMotion = true; listeners.forEach(listener => listener()); });
  expect(result.current.animation).toBe(false);
  unmount();
  expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  expect(listeners.size).toBe(0);
});

it('supports a browser without matchMedia without introducing a render-time failure', () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: undefined });
  const { result } = renderHook(useChartMotion);
  expect(result.current.animation).toEqual({ duration: 150 });
});
