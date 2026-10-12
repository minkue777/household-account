# 알림 진입의 문서 재사용과 늦은 초기 조회 관측

## 확인한 사실

- 2026-10-12 07:48:57 KST 기록의 첫 홈은 9,995ms였다. 문서 응답 1,381ms, 인증 완료 3,695ms, 초기 조회 시작 약 3,739ms, 750ms 뒤 구독 전환, 네 원본 서버 snapshot 9,851~9,859ms, 홈 준비 9,878ms, 표시 9,995ms였다.
- 사용자는 알림을 눌러 진입했다고 설명했다. 기존 worker는 열린 same-origin 창에도 `navigate`를 호출하고 `/expenses/:id/edit`의 307을 거쳤다. 해당 로그에는 알림 식별자가 없어 클릭과 표본의 직접 연결은 확정할 수 없다.
- 서버 자료를 기다린 약 5.4초의 세부 원인은 미확정이다. 기존 초기 조회는 제한 이후 결과를 폐기하면서 실제 완료 시각도 버려 Lite와 Listen의 지연을 비교할 수 없었다.

## 변경 계약

1. PWA-006/T-PWA-004: 검증한 알림의 기존 앱 창을 focus하고 MessageChannel로 지출 열기를 요청한다. 앱이 수락하면 Next router로 이동하며 문서를 재로딩하지 않는다. 구버전·응답 없음은 유한 시간 후 일반 navigation, 창이 없으면 openWindow로 복귀한다. 목적지는 구조화된 ID로 만든 `/?edit=…`이며 기존 redirect 링크는 호환용으로 유지한다. 원장의 기존 권한·세션·가구 검증을 그대로 사용한다.
2. ADM-006/T-ADM-005: 네 원본의 `InitialReadCompleted`, `InitialReadFailed` 선택 시각을 허용한다. Completed는 조회 Promise 성공, Failed는 거절이며 예산 안에 받은 결과(해석 전)를 뜻하는 Received와 구분한다. 예산 초과 후에도 현재 구독/세션이며 첫 홈 관측 중이면 기록한다. 해제·세션 교체·첫 표시 이후에는 기록하지 않는다. 원문·ID·URL·오류 메시지를 로그에 추가하지 않는다.
3. iPhone 750ms/Android 2,000ms 예산, 늦은 결과 폐기, 구독 1회, 전체 홈 준비 후 표시와 기존 접속 집계는 유지한다. 서버 허용 목록을 먼저 배포하고 이후 Web을 배포한다. Android APK 변경은 없다.

## 검증 계획과 추적성

| 계약 | 검증 경로 | 기대 결과 |
|---|---|---|
| PWA-006 | 실제 worker entry 단위 검사·앱 receiver·production browser | payload 검증, 수락 시 reload 0회, 구버전 복귀, cold link·타 가구 차단 |
| ADM-006 | 초기 조회 계약·서버 normalizer·명령→실제 logger | 늦은 성공/실패 시각만 추가, 기존 표시/집계 불변, 개인정보 차단 |

## 로컬 검증

- 서버 normalizer·명령→실제 logger 126개, Web 관련 Jest 5개 파일 76개와 양쪽 타입 검사 통과. worker focus 처리 조정 후 관련 2개 파일 20개도 통과했다.
- 실제 Emulator와 production build의 Chromium/WebKit 검사 9개 통과: 새 홈 링크·기존 307 링크·과거월 편집·타 가구 차단·Lite 정상/지연 관측. 지연 주입에서 네 원본 Completed 1,480ms, Fallback 1,037~1,054ms, 서버 snapshot 1,673ms가 실제 접속 로그에 전달됐으며 늦은 결과는 표시되지 않았다.
- 최종 `notification-warm-entry.spec.ts`의 실제 생성 worker click → MessageChannel → Next router → 과거월 지출 편집 검사는 Chromium 1개 통과(38.6초, build 포함). 설정 화면에서 `performance.timeOrigin` 유지, 문서 navigation 0회, 인증 요청 재시작 0회를 확인했다. payload 보안의 실제 worker E2E도 1개 통과했다.
- 알림 표시 검사의 headless shell 권한 오류와 describe 안 channel 설정 오류는 테스트 환경 문제였다. 알림 검사를 별도 파일의 full Chromium으로 설정해 실제 Notification API를 사용한다. OS 클릭 이벤트 전달·waitUntil 수명만 시험 도구가 대신하며 실제 iPhone의 OS focus/openWindow는 현장 관측 범위다.
- 로그: `TEMP/household-notification-{startup,worker,warm-entry,security}-e2e-20261012.log` 및 후속 `worker-e2e-final` 로그. Emulator는 정상 종료했다.

배포는 진단 서버를 먼저 완료한 후 같은 후보 Web을 Git push로 진행한다. 이 변경으로 네트워크/SDK 지연 자체가 해결됐다고 판단하지 않는다.

## 서버 선행 배포

`ac0e969af130344473e07ef1a6a7e17a0e38d0f7`의 release `release-20261012-notification-startup-ac0e969`를 default·payment-capture·access-session에 배포했다. wrapper의 clean HEAD/hash·architecture 43개 검사, 실제 로그인·가구 Query와 정확한 배포 marker 검증이 모두 통과해 성공 provenance가 기록됐다. 운영 업무 자료는 직접 변경하지 않았다. Web은 이 제품 변경과 본 배포 기록을 함께 main에 push하여 Git 자동배포하며 전체 CI는 별도로 추적한다.
