# iOS 단축어 런타임 구성

이 문서는 [상세 설계](design.md)의 배포 구성과 영속 경계를 구체화합니다.

## 비밀과 설치 템플릿

- `SHORTCUT_CREDENTIAL_PEPPER`는 Firebase Secret으로 주입하며 32바이트 이상의 임의값이어야 합니다. 원문 자격 증명은 Firestore·명령 receipt·로그에 저장하지 않고 `HMAC-SHA-256` 결과만 `shortcutCredentials`에 저장합니다.
- `SHORTCUT_INSTALL_URL`은 endpoint·POST·JSON·Authorization·typed 응답 처리가 미리 구성된 공개 iCloud Shortcut URL이어야 합니다.
- `SHORTCUT_CREDENTIAL_KEY_VERSION`은 현재 hash key 운용 버전을 식별합니다.

배포 전 Secret은 다음과 같이 별도로 등록합니다. 값 자체는 저장소나 명령 기록에 남기지 않습니다.

```powershell
firebase functions:secrets:set SHORTCUT_CREDENTIAL_PEPPER
```

## HTTP 경계

- `SHORTCUT_CORS_ORIGINS`는 쉼표로 구분한 HTTPS origin allowlist이며 `*`는 허용하지 않습니다. Origin이 없는 iOS Shortcut 요청은 Bearer 검증을 그대로 거치고, CORS 성공을 인증으로 취급하지 않습니다.
- body·message·idempotency key 상한은 `SHORTCUT_MAX_BODY_BYTES`, `SHORTCUT_MAX_MESSAGE_CHARS`, `SHORTCUT_MAX_IDEMPOTENCY_KEY_CHARS`로 조정합니다.
- IP/credential 분당 한도와 credential 일일 quota는 `SHORTCUT_IP_REQUESTS_PER_MINUTE`, `SHORTCUT_CREDENTIAL_REQUESTS_PER_MINUTE`, `SHORTCUT_CREDENTIAL_REQUESTS_PER_DAY`로 조정합니다.
- 수치가 누락되면 유한한 기본값을 사용하고 0·음수·무한대는 함수 시작 단계에서 거부합니다.

## 영속성과 호환 이름

- HTTP idempotency receipt와 rate counter는 각각 `shortcutHttpReceipts`, `shortcutIngressCounters`에 저장하며 `expiresAt` TTL로 정리합니다.
- credential 발급 receipt에는 credential ID·version만 저장하고 원문을 저장하지 않습니다.
- 외부 함수 이름 `addExpenseFromMessage`는 호환성을 위해 유지하지만 구현은 `firebaseShortcutHttp` composition root입니다.
- body의 `householdId`·`createdBy` 계열 필드는 호환 입력으로 읽더라도 Actor 결정에는 사용하지 않습니다.
