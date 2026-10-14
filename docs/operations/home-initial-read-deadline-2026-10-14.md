# 첫 홈 초기 조회 제한 정비 — 2026-10-14

## 문제와 범위

- 10월 14일 iPhone 첫 홈 2건은 총 6,908ms·5,899ms였다. 각 원본의 정상 초기 조회가 750ms를 넘었다는 이유로 폐기되어, 이미 완료한 조회 대신 약 2.3~2.6초 뒤 realtime 결과를 다시 기다렸다.
- iPhone 750ms·Android 2,000ms 원본별 제한을 제거한다. 가구 metadata 조회·인증의 기존 제한, 서버 권한, 배당·원장 데이터와 Service Worker 정책은 변경하지 않는다.
- 제품 변경은 Web 공유 코드다. Firebase·APK 재배포 대상은 없으며 실제 Android WebView 검사는 새 계약에 맞춘다. 운영 성능 개선량은 배포 후 관측으로 확인해야 한다.

## 계약과 설계

| 경계 | 계약 |
|---|---|
| 입력 | 인증된 SessionScope에서 모바일 첫 `/` 홈의 월 원장·카테고리·홈 설정·지역화폐 잔액을 병렬 초기 조회한다. 원본별 문서당 1회이며 이후 월 이동·재연결은 기존 구독을 사용한다. |
| 성공 | 지연 시간과 관계없이 정상 응답을 먼저 반영한 뒤 같은 원본의 realtime 구독을 시작한다. 최초 watch cache는 무시하고 이후 서버 변경·낙관적 수정·삭제를 유지한다. |
| 실패 | 실제 조회·해석 실패에만 기존 realtime 경로로 복귀한다. 정상 응답을 시간 초과로 버리거나 중복 초기 조회하지 않는다. |
| 무응답 | 인증 후 첫 홈 데이터 전체 대기에만 20초 제한을 둔다. 일부 데이터 수신으로 제한을 연장하지 않는다. 오류·재시도를 제공하고 준비 완료/paint는 기록하지 않는다. 재시도는 새 문서를 열며, 그 전에 전체 정상 응답이 도착해도 같은 화면을 복구한다. |
| 취소·저장 | unmount·scope 교체는 이전 응답을 무효화한다. 가구 전환에는 전체 대기를 새로 시작하고 한번 표시한 가구의 갱신에는 적용하지 않는다. 새 영속 상태나 업무 write는 없다. |

`initialHomeRead.ts`의 원본별 timer·decided 상태를 제거한다. `LedgerPage`의 기존 전체 준비 조건과 오류·재시도를 사용하며 데이터 대기 timer만 소유한다. 인증 자체의 대기와 중복하지 않는다.

## 검증 추적성

| 계약 | 검증 |
|---|---|
| AND-012 / T-WEBVIEW-004 / T-SYS-008 | `initialHomeRead.contract.test.ts`: 느린 정상 응답, 실제 실패 복귀, 취소·scope, 공유 구독, 최신 projection 보존 |
| LED-001 / T-LED-001 / HOME-003 | `homeFirstCompletePaint.contract.test.tsx`: 20초 경계, 부분 응답에도 동일 deadline, 늦은 정상 복구, 가구 전환·후속 갱신 |
| T-WEBVIEW-004 / T-ADM-005 | `ios-startup.spec.ts`: 실제 Emulator 응답을 2.5초 이상 보류한 뒤 Listen보다 먼저 완성 홈 표시, 무응답 오류와 실제 새로고침 재시도 |
| AND-012 / T-ANDROID-STARTUP-001 | `WebStartupFirebaseE2ETest.kt` / `native-firebase.mjs`: 실제 WebView의 2.5초 초기 응답, 전체 대기 초과 후 늦은 복구와 live 갱신, Native 시작 계측 중복 금지 |

## 실행 결과

- 변경 전에는 느린 정상 응답 채택과 전체 무응답 경계 검사가 실패했다. 변경 후 관련 Jest 11개 파일 122개, TypeScript `tsc --noEmit`, 요구사항 catalog·E2E 추적성 검사가 통과했다.
- 제한된 실행 환경에서는 Vite/Next build가 `spawn EPERM`으로 중단됐다. 사용자 권한 변경 뒤 같은 E2E 준비 경로의 Functions architecture 43개와 세 codebase 빌드가 통과했다. 검사 설정을 바꾸거나 생략하지 않았다.
- 실제 WebKit·Android 검증과 배포 결과는 아래에 기록한다. 로컬 로그: `TEMP/household-initial-deadline-{related,prepare,webkit,retry-webkit,native,native-compile}-20261014.log`.

### 후속 검증과 배포

- 제품 `13d927787d18f942bc052c37c98dfcd7b51b24f3`의 Vercel Git 자동배포와 GitHub Production deployment `7065099574`가 성공했다. 운영 `/`·`/sw.js` HTTP 200과 SHA 포함, 해당 SHA `_buildManifest.js` HTTP 200을 확인했다. Firebase·APK는 변경하지 않았다.
- 실제 Emulator/production build/WebKit에서 지연 초기 응답의 Listen 선행 표시, 마지막 잔액까지 전체 대기, live 전환 후 수정·삭제 3개가 통과했다.
- 새 무응답·재시도 검사는 오류 상태 도달 후 `role=alert`가 앱 오류와 Next.js `__next-route-announcer__` 두 개에 일치해 실패했다. 제품 오류가 아니라 검사 선택 범위 문제이며, WebKit과 Android 관측을 실제 `main` 오류 영역으로 한정했다. 20초·실제 새로고침·최신 금액·완료 계측 검증은 유지한다.
- Android instrumentation Kotlin 컴파일은 통과했다. API 36.1 에뮬레이터 시작 때 발생한 시스템 Bluetooth 오류 대화상자만 닫고 HOME 포커스를 확인했다. 앱 오류를 닫거나 검증을 생략하지 않았다.
- 보정한 WebKit 무응답·실제 새로고침 검사는 **1 passed (56.7s, production build 포함)**다. 첫 문서에서는 20초 오류·완료 paint 0회·접속 Command 0회, 새 문서에서는 최신 47,901원과 완료 paint·접속 1회를 확인했다. 앞선 3개 성공과 합쳐 관련 브라우저 계약 4개를 확인했다.
- 실제 API 36.1 Activity/Keystore/Firebase/production Web을 거치는 Native E2E **4개**와 후속 Native→Web Chromium **1개**가 통과했다. 네 초기 조회의 실제 정상 응답을 2.5초 이상 지연해도 fallback 없이 Listen보다 먼저 반영한다. 같은 Activity 재로딩에서 전체 20초 오류를 확인한 뒤 보류 응답을 전달해 36,890원으로 복구하고 후속 live 47,901원 갱신을 확인했다. 같은 Activity의 추가 시작 총시간 표본은 0개이며 실제 logger 진단 보존도 검증했다.
- 구현 SHA `13d92778`의 CI는 `38562856907`, 검사 보정 SHA `e85cd5e69a45f680075e3ccea668ad26220094ae`의 CI는 `38563298162`다. 후속 전체 CI와 실제 Android job은 아직 진행 중이며 성공으로 보고하지 않는다. 최초 실행의 실패 이력도 별도로 확인한다. Web 제품 배포는 완료됐고 후속 테스트·문서는 추가 제품 배포가 필요 없다.
- 로컬 Firebase 서버·Android 에뮬레이터는 정상 종료했다. 운영 업무 데이터는 변경하지 않았다. 이번 검증은 응답 전환과 오류 복구 계약이며 실제 사용자 환경의 단축 시간을 보장하는 성능 측정은 아니다.

### CI 후속: 지역화폐 최초 선택 경합

- 검사 보정 SHA `e85cd5e69a45f680075e3ccea668ad26220094ae`의 CI `38563298162`는 다섯 검사·요약 모두 성공했다. 실제 Android instrumentation/Native Firebase 검사도 실행 후 성공했다. 제품 CI `38562856907`의 Web E2E 실패는 위에서 수정한 `role=alert` 선택 범위 문제이며 별도 새 실패는 없었다.
- 문서 SHA `bf1ad1e3a8fc0f17c0ce3b73554da397db8b77be`의 CI `38563801816`은 Web/Android/Web E2E 성공, Functions 실패다. 실제 Firebase 통합 검사 151개 중 기존 지역화폐 최초 두 종류 동시 접수 1개가 `3 INVALID_ARGUMENT: Transaction is invalid or closed`로 실패했다. 초기 홈 변경이 이 서버 경로를 바꾸지는 않았다.
- 보존한 Emulator 로그에는 12:30:21 UTC의 query/commit 잠금 timeout과 12:30:24·28의 닫힌 transaction 재조회 오류가 있다. 최초 실패보다 앞선 잠금 경합은 확인했지만, transaction ID·최초 RPC 상태가 없어 SDK 내부 재시도 경로와 운영 재현 여부까지 확정하지 않았다. 10월 5일 같은 실패도 기록돼 있으며 이미 순차 조회하는 제품 코드에 오류 문자열 재시도 분기를 추가하지 않는다.
- 검사는 실제 SDK의 두 transaction이 같은 초기 상태에서 쓰기를 준비한 뒤 commit하도록 순서를 고정한다. 두 최초 callback이 모두 `created`인 것과 SDK callback 재시도가 실제 발생한 것을 추가 확인한다. 두 요청은 `allSettled`로 모두 종료한 뒤 정리하며, 실패 시 SDK 로그·시도 횟수·최초 결과를 남긴다. 기존 잔액 2개·receipt 2개·선택 version 3·선택 event 1개·잔액 event 2개·재전송·stale·abort 원자성 및 30초 제한은 유지한다.
- 변경한 실제 Firestore Emulator 검사 **2 passed (8.60s)**, Functions 테스트 타입 검사가 통과했다. 검사 순서 보강이며 임의 query/commit 교차에서 발생한 SDK/Emulator 오류가 제품에서 해결됐다는 의미는 아니다. 이번 실패 기록은 유지하고 후속 SHA의 전체 CI를 확인한다. 테스트·문서만 바뀌므로 Firebase/Web/APK 추가 배포는 필요 없다.
- 증거: `TEMP/household-initial-deadline-functions-38563801816.log`, `TEMP/household-initial-deadline-functions-artifacts-38563801816/firestore-debug.log`, `TEMP/household-local-currency-contention-20261014.log`.
