type SessionReset = () => void;

const loadedFeatureResets = new Set<SessionReset>();

/**
 * 기능이 실제로 로드된 뒤에만 세션 초기화 대상에 등록합니다.
 *
 * 최상위 Session Provider가 모든 기능 구현을 정적으로 import하지 않아도
 * 가구 전환·로그아웃 시 이미 사용한 기능의 메모리 상태는 동기식으로 폐기됩니다.
 */
export function registerClientSessionReset(reset: SessionReset): () => void {
  loadedFeatureResets.add(reset);
  return () => loadedFeatureResets.delete(reset);
}

export function resetLoadedClientSessionState(): void {
  loadedFeatureResets.forEach((reset) => reset());
}
