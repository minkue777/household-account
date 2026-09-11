# 실제 앱 E2E 보강 — 2026-09-11

## 검증 구조

기존 테스트 감사의 후속 작업입니다. 브라우저의 실제 로그인·화면 조작, 운영 Functions 진입점, Auth/Firestore Emulator를 연결합니다. Android는 실제 Listener·암호화 Queue·Firebase SDK·Quick Edit·서버 저장·Web 조회를 연결합니다. PWA는 production 빌드가 생성한 서비스워커를 실제 브라우저에서 실행합니다.

FCM/APNs 전달, 결제 앱의 OS callback, 외부 시세·Cloud Logging 응답과 서비스 계정 OAuth는 자동 테스트의 외부 경계입니다. 이 입력·전송만 통제하며 내부 업무 로직을 테스트용으로 다시 구현하지 않습니다. 관리자 속도 통계는 실제 로그 reader·중복 제거·집계·화면을 거쳐 표본 수, 평균, P95까지 확인합니다. 실제 운영 배포와 물리 iPhone의 알림 수신·성능을 이 테스트의 통과로 주장하지 않습니다.

## 요구사항과 삭제 기준

- 선언된 요구사항 244개 중 240개에 실행 E2E 경로를 연결했습니다. 현재 공개 경로가 없는 과거 Shortcut 동작 1개와 실제 운영 release가 필요한 3개는 [명시적 경계](e2e-exceptions.json)로 기록했습니다.
- [요구사항 연결표](e2e-requirement-coverage.md)는 실제 테스트 함수 및 Native 메서드의 존재를 검사합니다. 주석에 ID만 적거나 직접 skip/todo한 테스트는 증거로 사용하지 않습니다. 연결 수는 모든 수용 조건의 통과율이 아닙니다.
- 제품 코드 대신 별도 참고 구현을 실행하거나 미사용 Application factory만 검사한 테스트를 삭제했습니다. 실제 모듈의 외부 포트를 대역으로 바꾸는 유효한 단위·통합 테스트는 유지합니다. 정적 검사도 운영 schema·금지 의존성·배포 설정을 검증하는 경우 유지합니다.
- 기존 거대한 Web 시나리오는 독립된 사용자 흐름으로 나눴습니다. 삭제 근거와 대체 경로는 [Native/알림](real-code-test-cleanup.md), [결제](e2e-payment-mapping.md), [재무](e2e-finance-mapping.md), [자산/관리자](e2e-portfolio-admin-mapping.md), [접근/운영](access-system-test-cleanup.md)에 기록했습니다.
- 이 과정에서 불필요·중복 검사와 제거된 코드의 테스트 118개 파일, 참고 구현 75개 파일, 전용 support 109개 파일을 정리했습니다. 삭제 수에는 실제 단위 테스트였지만 대상 TTL 코드 자체가 제거된 경우도 포함하므로, 모두 가짜 테스트였다는 뜻은 아닙니다.

## 실행 중 발견한 제품 결함

- 수입 추가 시 사용자가 입력한 항목명 대신 일반 수입명이 전달됐습니다. 실제 UI 입력을 Command의 항목명으로 전달하도록 수정했습니다.
- 새 지출의 초기 카테고리를 목록 첫 항목으로 선택했습니다. 현재 기본 카테고리를 우선하도록 수정했습니다.
- 현재 달에 없는 지출 알림 링크가 검색창으로만 이어졌습니다. 서버에서 자기 가구의 대상 한 건을 확인한 뒤 해당 월·수정 화면을 엽니다. 없는 거래와 다른 가구 거래는 정보를 노출하지 않습니다.
- 배당 조회 실패를 빈 데이터로 바꿔 표시했습니다. 실제 데이터 없음과 조회 실패를 구분하고, 없는 문서에 대한 Rules 거절을 피하도록 가구 조건으로 스냅샷을 조회합니다.
- 수동 거래에서 안전한 정수 범위를 넘는 금액을 허용했습니다. 실제 서버 금액 검증을 `Number.isSafeInteger`로 수정했습니다.
- 카드 끝번호·가맹점 규칙·카테고리를 수정해도 이전 설정을 최대 60초간 사용했습니다. 정상 경로는 이미 Firestore projection 한 문서만 읽으므로 중복 메모리 캐시를 제거하고 동시 요청 병합은 유지했습니다. 보관 카테고리의 실제 `state` 필드도 projection에서 제외합니다.
- 관리자에서 제거한 멤버가 기존 JWT로 새 3,300원 결제를 저장하는 문제를 재현했습니다. 매 수집에서 현재 Membership을 권위 조회하고, Native JWT의 가구·멤버 힌트도 현재 Membership과 일치해야 합니다. 오래된 JWT를 다른 가구의 신원으로 재해석하지 않습니다.
- production CSP가 Firebase Storage의 종목 목록 요청을 차단했습니다. 실제 필요한 `https://firebasestorage.googleapis.com`만 허용 목록에 추가했습니다. 개발 서버에서만 검증하면 놓치는 결함이었습니다.
- 설정을 바로 반영하도록 하자 같은 원문 재시도의 receipt fingerprint에 변경된 규칙의 파생 값이 섞이는 결함이 드러났습니다. 서버에서 검증한 원문·가구·생성자로 지문을 만들고, 클라이언트가 제출하는 typed 입력은 별도의 원본 사실을 검증하도록 수정했습니다. 공개 요청에서 내부 검증 필드를 위조할 수 없습니다. 과거 receipt의 복원 불가능한 정보는 추측해서 허용하지 않습니다. [상세 경계](capture-replay-identity.md)를 참고합니다.

## 실행 기록

Web 전체 실행을 완료했으며 Native와 최종 일반 production PWA 실행이 진행 중입니다. 아래 통과는 해당 실행 범위의 증거이며, 아직 실행하지 않은 새 시나리오의 성공을 뜻하지 않습니다.

첫 공식 Web 전체 실행은 89개 중 84개 통과·5개 실패·생략 0개였습니다(6분 31초). iPhone WebKit 3개는 모두 통과했습니다. 실패는 실제 receipt 재시도·Storage CSP 결함 2개와 테스트 기대·관측 오류 3개로 구분했습니다. 기존 exact 규칙을 덮어쓰지 않는 계약과 공개 오류 코드에 테스트를 맞추고, PWA는 같은 문서의 history 이동을 제외한 실제 문서 로딩만 셉니다. 테스트 사이에는 이전 Outbox 소비 완료를 확인하고 데이터를 초기화합니다.

수정 후 공식 전체 실행은 89개 모두 통과했습니다(356.293초, Chromium 86개·iPhone WebKit 3개, 실패·skip·flaky 0개, 명령 종료 코드 0). 실제 규칙 변경 뒤 원문 재시도, Storage 종목 검색, 관리자 로그 집계, 알림·멤버 권한 제거/복구를 함께 확인했습니다.

| 검증 | 현재 확인 결과 |
|---|---|
| Functions 품질 게이트 | 211개 파일·1,699개 통과, 타입·경계 검사·빌드와 별도 architecture 39개 성공 |
| Web Jest | 96개 파일·613개 통과, 생략 없음 |
| Firestore Rules·Firebase adapter 통합 | 14개 파일·75개 통과 |
| Storage Rules | 실제 Storage Emulator에서 3개 통과 |
| callable HTTP 통합 | 실제 세 Functions codebase와 Auth/Firestore에서 3개 통과 |
| Android 기본 instrumentation | 29개 통과, 실패·생략 없음; JVM·lint·debug/release 빌드 성공 |
| Web 전체 E2E | 89개 통과, 실패·생략·flaky 없음 |
| Native Firebase·일반 production PWA E2E | 최종 실행 후 결과 갱신 |

Functions 기본 실행에서 조건부 통합 81개가 제외되므로 별도 Emulator 실행 결과와 합쳐 판단해야 합니다. CI의 다섯 필수 job을 유지하며, Web-only 변경에 Android Emulator를 추가로 의무화하지 않았습니다.

## 재실행

- `npm --prefix functions run test:quality-gate`
- `npm --prefix web test -- --runInBand`
- `npm --prefix web run test:e2e` — production Web, 세 Functions codebase, 실제 Auth/Firestore, Chromium·WebKit
- `npm --prefix web run build` 후 `npm --prefix web run test:e2e:pwa` — 일반 production 빌드의 헤더·worker·알림 navigation
- 실행 중인 Android Emulator에서 `npm --prefix web run test:e2e:android` — Native Firebase 3개와 서버 저장 결과의 Web 확인

E2E 환경은 고정된 `demo-household-account-e2e`와 loopback Emulator만 사용합니다. 실제 사용자 계정이나 운영 가구를 입력하지 않습니다. 실패 trace·스크린샷·JSON/JUnit 결과는 CI artifact로 보존합니다.
