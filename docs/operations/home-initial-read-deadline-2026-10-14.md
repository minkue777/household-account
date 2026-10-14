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
- 실제 WebKit·Android 검사는 실행 중이며 배포 완료를 의미하지 않는다. 로컬 로그: `TEMP/household-initial-deadline-{related,prepare,webkit}-20261014.log`.
