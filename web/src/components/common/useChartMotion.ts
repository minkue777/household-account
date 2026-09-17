'use client';

import { useMemo, useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const TRANSITION_DURATION_MS = 150;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribeToMotionPreference(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const preference = window.matchMedia(REDUCED_MOTION_QUERY);
  preference.addEventListener('change', onChange);
  return () => preference.removeEventListener('change', onChange);
}

const serverPreference = () => false;

/** Product chart motion, shared by expense and asset statistics, including OS changes. */
export function useChartMotion() {
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, serverPreference);
  return useMemo(() => ({
    animation: reducedMotion ? false as const : { duration: TRANSITION_DURATION_MS },
    transitions: {
      // Chart.js otherwise gives point/hover changes a separate 400ms duration.
      active: { animation: { duration: reducedMotion ? 0 : TRANSITION_DURATION_MS } },
    },
  }), [reducedMotion]);
}
