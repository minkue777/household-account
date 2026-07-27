/**
 * Native Android Activity가 기존 WebView 화면으로 복귀했음을 알리는 host 계약입니다.
 *
 * 인증 복구는 AppProviders가, 화면별 최신 읽기 확인은 해당 read model이 각각 처리합니다.
 * 이 이벤트 자체가 전역 Firestore read epoch를 증가시키면 안 됩니다.
 */
export const ANDROID_NATIVE_RESUME_EVENT = 'household-account:android-resume';
