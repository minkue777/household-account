import {
  firestoreTransportSettings,
  type FirestoreRuntimeEnvironment,
} from '@/platform/read-model/firestoreTransportPolicy';

describe('T-WEBVIEW-004 AND-012 Firestore WebView 전송 계약', () => {
  const browser: FirestoreRuntimeEnvironment = {
    androidHostBridgeAvailable: false,
    userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
  };

  it('Android native host에서는 Firestore long-polling을 강제한다', () => {
    expect(firestoreTransportSettings({
      ...browser,
      androidHostBridgeAvailable: true,
    })).toEqual({ experimentalForceLongPolling: true });
  });

  it('브리지가 아직 보이지 않아도 Android WebView user agent이면 long-polling을 강제한다', () => {
    expect(firestoreTransportSettings({
      androidHostBridgeAvailable: false,
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A; wv) ' +
        'AppleWebKit/537.36 Version/4.0 Chrome/138.0 Mobile Safari/537.36',
    })).toEqual({ experimentalForceLongPolling: true });
  });

  it('일반 브라우저에는 WebView 전용 전송 설정을 적용하지 않는다', () => {
    expect(firestoreTransportSettings(browser)).toEqual({});
  });
});
