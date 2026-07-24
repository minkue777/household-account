import { getClientSessionScope } from '@/composition/clientSessionScope';
import { isAndroidHostAvailable } from '@/platform/android-host/androidHostBridge';

let visitPromise: Promise<void> | undefined;

function visitId(): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `app-visit-${suffix}`;
}

const currentVisitId = visitId();

function platform(): 'android' | 'ios-pwa' | 'web' {
  if (isAndroidHostAvailable()) return 'android';
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true
    || ('standalone' in navigator
      && (navigator as Navigator & { standalone?: boolean }).standalone === true);
  return standalone ? 'ios-pwa' : 'web';
}

/**
 * 앱 문서 생명주기당 한 번만 기록합니다. 화면 표시나 기능 사용을 기다리게 하지
 * 않으며, 실패한 운영 통계는 사용자 기능 실패로 전파하지 않습니다.
 */
export function recordCurrentAppVisit(): Promise<void> {
  visitPromise ??= (async () => {
    const scope = getClientSessionScope();
    if (!scope || scope.accessMode !== 'member') return;
    const { householdCommands } = await import(
      '@/features/access-household/application/householdCommands'
    );
    await householdCommands.recordAppVisit({
      visitId: currentVisitId,
      platform: platform(),
    });
  })().catch(() => {});
  return visitPromise;
}
