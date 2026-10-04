# PWA 갱신과 진행 중 온라인 요청의 수명 분리

## 조사 범위와 확인한 사실

- CI `37206047688`, `37209273668`의 `web`에서 `production-runtime.spec.ts`의 새 worker 활성화가 15초 안에 끝나지 않았다.
- 두 번째 실행의 trace에는 올바른 버전 `d05cfc7d-46a9-4950-89fd-f5c985f5d8af` handshake와 `ACTIVATE_WAITING_WORKER` 전송이 있다. lifecycle 첨부에서 후보는 `installed/waiting`, 기존 active/controller는 `activated`로 유지됐다.
- 당시 기록은 worker 내부의 메시지 수신, `skipWaiting()` 실행, 기존 worker의 진행 중 extendable event를 포함하지 않았다. **따라서 아래 재현 결함이 원래 CI의 직접 원인이었는지는 아직 확정하지 않는다.**
- 같은 production artifact의 별도 로컬 관측 15회에서는 정상 활성화했다. 반복 횟수를 성공 근거로 삼거나 원래 실패를 재현했다고 표현하지 않는다.

## 직접 재현한 제품 결함

기존 `next.config.js`는 정적 allowlist 다음에 모든 GET을 Workbox `NetworkOnly`로 처리했다. Cache Storage에 저장하지 않는 요청도 worker가 실제 fetch와 `waitUntil`을 소유하는 구조였다.

실제 HTTP 서버에서 비정적 GET의 응답을 보류하고, 실제 production worker에 올바른 버전으로 갱신을 요청했다. 관측 결과:

1. 기존 worker의 pending event는 보류한 URL의 `fetch`였다.
2. 후보 worker는 `ACTIVATE_WAITING_WORKER`를 받았고 실제 `skipWaiting()`을 호출했다.
3. 15초 후에도 후보가 대기해 회귀 검사가 실패했다.
4. 기존 요청의 HTTP 응답을 해제하자 후보가 즉시 활성화됐다.

이는 [Service Workers의 Try Activate](https://www.w3.org/TR/service-workers/#try-activate)의 기존 active worker pending event 조건과 일치한다. [Workbox NetworkOnly](https://developer.chrome.com/docs/workbox/modules/workbox-strategies/#network-only)는 브라우저가 직접 요청하는 것과 달리 service worker를 거쳐 네트워크로 전달한다.

## 변경과 계약

- 마지막 catch-all `NetworkOnly` 규칙만 제거했다. 정적 precache/runtime cache allowlist, 7일 만료, cache response 검증은 유지한다.
- 일치하지 않는 요청은 브라우저 기본 온라인 경로로 진행한다. HTML·API·금융·인증·임의 cross-origin 요청을 worker `respondWith`/`waitUntil`에 붙잡지 않는다.
- `skipWaiting()` 조건, 버전 일치 handshake, 미저장 입력 확인, 사용자 갱신, 기존 15초 E2E 활성화 기준을 바꾸지 않았다.
- Firebase Messaging, push payload 검증, notification click, worker scope는 변경하지 않았다.
- 배포된 기존 worker의 진행 중 요청은 새 파일만 배포해서 소급 해제할 수 없다. 이번 코드가 active worker로 전환된 뒤의 요청부터 새 경로를 사용한다.
- Web runtime build 설정 변경이므로 Vercel Git 자동배포가 필요하다. Firebase·APK 변경은 없다.

## 테스트 추적성

| 요구사항·계약 | 검증 |
|---|---|
| PWA-003/008의 안전한 worker 전환 | `production-runtime.spec.ts`의 기존 handshake·잘못된 버전 거부·active/controller 일치와 새 실제 HTTP 보류 중 갱신 검사 |
| PWA-004의 민감 응답 비캐싱 | 기존 `worker-events.spec.ts`의 식별자 URL·인증 header·API·HTML 및 offline HTML 회귀 유지 |
| 비정적 요청이 worker 처리 대상에서 제외됨 | `pwaRuntimeCache.contract.test.ts`에서 실제 구성의 모든 runtime rule을 대상으로 URL·cross-origin·인증·cookie·method별 handler 선택 검사 |
| PWA-005/006의 Messaging·클릭 | 실제 생성 worker의 Firebase Messaging SDK, foreground 전달·background data-only 1회 표시·잘못된 payload 거부·클릭 목적지 검사 유지 |

새 E2E는 임시 local HTTP proxy로 실제 Next production build를 제공하고 명시한 읽기 URL 한 개의 응답만 서버에서 보류한다. service worker·메시지·시간·응답 객체를 대체하지 않는다. 응답이 여전히 열린 상태에서 후보 active/controller 전환을 검증하고, 해제한 응답 본문이 원래 client에 도달하며 cache에 남지 않는 것도 확인한다.

## 로컬 검증

- 수정 전 새 실제 HTTP 회귀: 15초 후 활성화 실패(예상된 회귀 재현).
- 수정 후 production build 및 artifact 검증 통과.
- 실제 Chromium PWA 전체 **6개 통과, 20.2초**: 기존 5개 + 신규 지연 HTTP 갱신 1개.
- PWA cache/update Jest 2개 파일 **8개 통과**.
- 운영 금융 데이터 변경 없음. CI의 기존 실패 이력은 유지하며 최종 원격 실행은 통합 커밋 SHA로 별도 추적한다.

로컬 증거:

- `TEMP/household-pwa-worker-probe-20261004.jsonl`: 정상 관측과 보류 요청 재현의 worker 메시지·skipWaiting·waitUntil 관측.
- `TEMP/household-pwa-pending-read-before-20261004.log`: 수정 전 회귀 실패.
- `TEMP/household-pwa-pending-read-build-20261004.log`: 변경한 production build.
- `TEMP/household-pwa-pending-read-after-20261004.log`: 실제 PWA 6개 통과.
- `TEMP/household-pwa-pending-read-unit-20261004.log`: cache/update 계약 검사.
