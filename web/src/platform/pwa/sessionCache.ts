/** 로그인 세대가 끝날 때 이전 사용자의 런타임 응답 cache를 폐기합니다. */
export async function clearPwaRuntimeCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const keys = await window.caches.keys();
  await Promise.all(keys.map((key) => window.caches.delete(key)));
}
