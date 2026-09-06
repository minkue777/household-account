/** 로그인 세대가 끝날 때 이전 사용자의 런타임 응답 cache를 폐기합니다. */
export async function clearPwaRuntimeCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const keys = await window.caches.keys();
  const obsolete = keys.filter(key => !key.startsWith('household-static-v1-') && key !== 'immutable-next-static');
  await Promise.all(obsolete.map(key => window.caches.delete(key)));
  const remaining = await window.caches.keys();
  if (obsolete.some(key => remaining.includes(key))) throw new Error('PWA_SESSION_CACHE_PURGE_FAILED');
}
