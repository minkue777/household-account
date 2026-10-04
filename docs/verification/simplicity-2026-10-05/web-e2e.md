# Web E2E 후속 정적 검토

시작·알림·PWA·Native→Web 관련 E2E 8개의 본문을 읽었다. 파일별 full-read 상태는 [files.csv](files.csv)에 있습니다. 실행, 테스트 변경, 제품 변경은 하지 않았습니다.

## 계약 흐름 및 보존할 검사

- `ios-startup.spec.ts` 473줄: 실제 production chunk와 resource timing → UI 첫 사용/실패 재시도 → 실제 Firestore canonical 확인, Listen 요청 보류 중 실제 Lite 읽기 → stream 복귀 후 변경/삭제, 실제 Auth 복원과 startup command/diagnostic timing 대조입니다. fake data 응답으로 성능을 증명하는 검사가 아닙니다. 750ms 같은 wall-clock budget은 이 파일에서 강제하지 않습니다. 실제 준비 단계·최신성·가입 scope·빈 잔액 준비 검증을 보존합니다.
- `notifications-helpers.ts` 104줄, `notifications.spec.ts` 270줄: 실제 callable/Emulator custom token, command→outbox→delivery→transport adapter, duplicate delivery·조건부 해제·멤버 제거 후 기존 JWT 거부·복구·purge 참여자 검증입니다. 공급자 결과 제어 fixture는 네트워크 외부 경계만 대체합니다. 실제 인증 token을 직접 위조하지 않는 helper와 Emulator-only guard를 보존합니다.
- `notification-deeplink.spec.ts` 40줄: 실제 로그인 복원·과거월 expense edit, 타 가구와 없는 ID 비노출을 검사합니다.
- `pwa-authenticated.spec.ts` 82줄: 실제 worker 자동 활성화 후 미저장 입력/사용자 폐기 승인/실제 navigation 한 번, 로그아웃 시 민감 cache 제거와 실제 JS 응답 hash 보존을 검사합니다. 필요한 회귀입니다.
- `settings-navigation.spec.ts` 37줄: 설정 섹션의 화면 재진입 초기화와 theme 영속화입니다. UI 상태가 계약이므로 aria-expanded 검사는 적절합니다.
- `presentation-layout.spec.ts` 21줄: 실제 긴 merchant 입력, viewport/scrollWidth, 저장 버튼 접근 가능성입니다. 시각적 문자열 모형이 아닙니다.
- `native-quick-edit.spec.ts` 20줄: Android가 남긴 fixture/result를 읽고 새로운 Web 세션에서 실제 저장값을 조회합니다. expense를 테스트 안에서 다시 seed하지 않아 Native→Web 연결 증거가 유효합니다.

## 추가 후보

### WE01 — 선택 상태를 CSS 구현으로 검증하는 작은 결합. P3, 확신 높음

`web/e2e/native-quick-edit.spec.ts:19`는 `간식` 버튼의 `border-blue-500` class를 확인합니다. 저장값 표시 확인은 유지하되 선택 상태를 aria-pressed/checked 등 의미 있는 UI 상태 또는 canonical categoryId와 연결하면 스타일 변경으로 계약이 깨지는 불필요 결합을 줄일 수 있습니다. 실제 저장·조회 경로 검사를 줄이는 제안이 아닙니다.

### WE02 — 첫 홈 성능 검사가 정확한 chunk 이름·개수를 고정합니다. P3, 확신 중간

`web/e2e/ios-startup.spec.ts:15~21`은 6개 기능 각각에 이름이 고정된 별도 JS chunk 하나를 요구합니다. 현재 지연 로드 구현을 검증하는 근거는 있지만 future bundle 합치기/이름 변경을 사용자 행동 회귀와 동일하게 막습니다. 사용자에게 필요한 계약은 첫 paint 이전 닫힌 기능 로드를 피함, 날짜 detail 준비, 로드 실패 재시도 및 사용 시 정상 동작입니다. performance resource 관측과 UI 확인을 유지하되 정확히 6개 파일이라는 구조는 문서/구현 세부로 분리할 수 있습니다. 즉시 삭제보다는 성능 예산 계약 정리 시 함께 조정할 낮은 우선순위입니다.

## 한계

다른 E2E와 helper·제품 코드는 [검증 경계](test-boundaries.md), [Web](web.md), [Web 테스트](web-tests.md)의 통합 범위를 따른다. runtime 실행·성능 측정이나 브라우저별 재현 결과를 주장하지 않습니다. notifications helper의 별도 node process는 실제 compiled production purge participant를 호출하므로 독립 업무 모형으로 분류하지 않았습니다.
