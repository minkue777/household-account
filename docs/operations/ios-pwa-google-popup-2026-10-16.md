# iPhone PWA Google 로그인 대기 복구

## 관측과 원인 범위

사용자는 설치된 iPhone PWA에서 Google 창이 보이지 않고 `로그인 중...`이 유지되는 화면을 제공했습니다. 다시 시도해도 같고 Safari에서는 로그인에 성공했다고 확인했습니다. 서버의 가구 접근 실패로 단정할 근거는 없습니다.

Firebase 12.16.0 실제 SDK는 `signInWithPopup`에서 resolver의 GApi·인증 iframe 준비를 기다린 뒤 창을 엽니다. 현재 앱은 2026-09-07 초기 로딩 최적화에서 초기화 의존성의 resolver를 제거했습니다. 모바일/Safari의 사전 준비가 클릭 이후로 밀려 iOS 사용자 활성화 시간 안에 창을 열지 못할 가능성이 생겼습니다. iOS standalone 경로는 임시 anchor의 합성 클릭을 사용하며 `AuthPopup(null)`을 반환합니다. SDK는 이 경로에서 창의 차단·닫힘을 관측할 수 없어 로그인 Promise를 계속 대기할 수 있습니다.

운영 페이지를 Playwright Chromium/WebKit에서 iPhone UA·standalone으로 열었을 때 Google 계정 선택 창은 열렸습니다. 이 결과는 설치된 실제 iPhone PWA의 증상 재현이나 계정 로그인 성공을 뜻하지 않습니다. 사용자 기기에서 창이 처음 열리지 않은 정확한 계기는 아직 미확정입니다.

근거: [Firebase 모바일 의존성 초기화](https://firebase.google.com/docs/auth/web/custom-dependencies#platform-specific_considerations), [WebKit 사용자 활성화](https://webkit.org/blog/13862/the-user-activation-api/), [Safari redirect 로그인 조건](https://firebase.google.com/docs/auth/web/redirect-best-practices).

## 계약과 변경

- 입력: 로그아웃 상태에서 사용자가 Google 로그인을 누릅니다. legacy 세션 후보를 캡처하는 기존 순서를 유지합니다.
- 준비: Web Auth 초기화에 SDK resolver를 복원합니다. 모바일/Safari는 GApi 로드와 iframe 연결 시작을 로그인 클릭 이전으로 당깁니다. SDK 초기화 완료는 iframe의 모든 응답 완료를 뜻하지 않습니다. Android는 기존 Native 인증을 사용합니다.
- 성공: 실제 Firebase 사용자만 기존 Membership 해석으로 전달합니다. 저장 우선순위·UID·서버 접근 검증을 바꾸지 않습니다.
- 실패: 기존 닫힘·차단 오류는 `null` 계약을 유지합니다. SDK가 응답하지 않는 팝업도 180초 후 `null`로 반환해 HouseholdContext의 오류 표시와 HouseholdLogin 버튼 복구로 이어집니다. 이 시간은 첫 화면 강제 대기가 아니라 사용자 계정 선택을 포함한 대화형 로그인 상한입니다.
- 늦은 성공: 시간 초과가 SDK 인증을 취소하지는 않습니다. 유효 사용자가 나중에 확정되면 기존 observer가 처리하며 다음 popup 호출은 SDK의 이전 popup 작업 취소 규칙을 따릅니다.
- 인증 알림 선행: 팝업 결과 전에 observer가 사용자를 복원했다면 뒤늦은 `null` 결과가 해당 세션을 로그아웃 화면으로 되돌리지 않습니다. 이 순서의 결함은 새 Provider 회귀가 수정 전 실패하고 한 조건으로 수정한 뒤 재검증합니다.
- 비용: 모바일/Safari 재방문도 SDK iframe 준비 비용을 다시 포함합니다. 이전 최적화의 속도 효과와 로그인 안정성을 동시에 확보했다고 보고하지 않습니다.

동일 출처 auth helper 설정 없이 `signInWithRedirect`로 교체하거나 SDK 내부 API·navigator를 제품에서 패치하지 않습니다. 운영 데이터·서버·APK 변경은 없습니다.

## 추적성과 검증

HH-001 / HH-003 / HH-008의 인증·최초 진입·Membership 계약을 유지합니다. 상세 설계의 반복 실행 Session 복원 순서를 이번 결정으로 갱신했습니다.

- `browserAuthBootstrap.contract.test.ts`: 초기 resolver·기존 저장 방식, 로그인 성공·닫힘·차단·재시도, 미완료 SDK Promise의 180초 종료.
- `androidAuthBootstrap.contract.test.ts`: Native 인증 및 resolver 없는 Android 초기화 유지.
- `browserLoginRecovery.contract.test.tsx`: 실제 HouseholdProvider·HouseholdLogin·authService와 SDK 경계 mock으로 미완료 로그인 3분 종료→오류·버튼 복구→재시도, 종료 후 늦은 인증, 인증 알림 선행 후 늦은 실패 무간섭을 검증합니다.
- `google-popup.spec.ts`: production build의 `/admin` Google 버튼은 E2E email 로그인 우회를 쓰지 않습니다. 실제 SDK·Google Auth Emulator widget을 통해 로그인 버튼 이전 GApi 준비·iframe 연결, Google provider 성공·관리자 권한 거절·일반 홈 첫 방문 인증 복원, Safari 창 닫기 후 재시도를 검사합니다. 계정 선택 UI는 Emulator이며 실제 Google 계정 인증이나 설치 기기의 팝업 차단 정책까지 검증했다고 보지 않습니다.
- Emulator 빌드에만 `frame-src http://127.0.0.1:9099`를 추가하여 실제 인증 iframe을 사용합니다. 운영 CSP에 loopback이 들어가지 않는 회귀를 함께 검증합니다.

검사 개발 중 iframe 응답 전체를 SDK 초기화 완료와 동일시한 관측을 GApi 준비 경계로 정정했습니다. Emulator 정적 버튼의 클릭 핸들러가 등록되기 전에 누르던 검사는 `DOMContentLoaded`를 기다립니다. Chromium에 iOS standalone을 강제한 경우 SDK의 가운데 클릭 합성 이벤트가 opener 없는 탭을 열어 Emulator의 `No matching frame` 오류가 발생했습니다. 동일 이벤트 독립 실행에서도 Chromium은 opener 없음, WebKit은 있음으로 확인했습니다. 실제 플랫폼에 맞게 Chromium은 모바일 Chrome, WebKit은 iPhone PWA/Safari로 구분하며 네 검사의 인증·UI assertion은 유지합니다.

## 결과와 배포

- Web 관련 6개 Jest 파일 49개 통과(인증/Provider 40개, CSP 9개). observer 선행→늦은 실패는 새 검사로 실패를 먼저 확인한 뒤 수정했습니다.
- Functions E2E 준비의 architecture 43개 통과, 요구사항 248개·시나리오 235개 선언과 실행 E2E 연결 누락 0개 확인.
- production build와 `tsc --noEmit --incremental false` 통과. 같은 production 산출물에서 실제 SDK/Emulator 브라우저 검사 4개(Chromium 2개·iPhone WebKit 2개)가 23.9초에 모두 통과했습니다. 로컬 Emulator는 정상 종료했습니다.

Web 실행 코드만 변경하므로 Vercel Git 자동배포 대상입니다. 실제 iPhone PWA 재시도 결과는 배포 후 확인해야 합니다. 로컬 검증 로그는 `%TEMP%/household-ios-google-popup-{prepare,e2e,e2e-corrected,e2e-final,e2e-platforms}-20261016.log`에 있으며 각 실패를 최종 성공으로 덮지 않습니다.
