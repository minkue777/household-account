# PWA 런타임 모듈 상세 설계

> 요구사항: [PWA 런타임 모듈 요구사항](requirements.md)  
> 상위 지도: [지원·읽기·플랫폼 영역](../../requirements.md)  
> 공통 형식: [모듈 상세 설계 규약](../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 설계는 `PWA-001~008`을 하나의 root-scope service worker 수명주기로 구현하는 기준이다. cache worker와 FCM worker를 별도로 경쟁 등록하지 않고, production artifact 하나가 설치·cache·background push·notification click을 함께 제공한다. 인증·가구·금융 응답은 cache 대상에서 제외하고 세션 전환 시 파생 상태를 폐기한다. 업무 payload와 알림 대상 정책은 [Notifications 모듈](../../../contexts/notifications/modules/notifications/design.md)이 소유한다.

## 2. 모듈 경계와 책임

| 소유 | 비소유 |
|---|---|
| manifest와 install metadata | Web 업무 화면 |
| worker build·등록·scope·version | FCM FID와 수신자 |
| 정적/runtime cache 수명주기 | 거래·자산 원본 데이터 |
| session cache purge와 Web 보안 header 정책 | 인증·Membership 판정 |
| Firebase worker 설정 생성·SDK 호환성 검사 | Firebase project 설정 값의 업무 의미 |
| worker update와 client 호환성 | Android WebView lifecycle |
| background push 표시·click routing Adapter | notification payload의 업무 의미 |

PWA에는 업무 Entity를 만들지 않는다. build plugin, Browser API와 Firebase Messaging을 Port/Adapter로 격리한다.

## 3. 공개 계약

### 3.1 Client 입력 계약

| 이름·종류 | 호출자 | 입력 | 결과 | 일관성 |
|---|---|---|---|---|
| `InitializePwaRuntime` Command | Web composition | environment, worker URL, expected version | `DisabledInDevelopment`, `Ready`, `UpdateAvailable`, `Failed` | 브라우저 등록 하나 |
| `PurgePwaSession` Command | 인증 composition | 이전 `sessionGeneration`, logout 또는 사용자·가구 change reason, change일 때만 `nextGeneration` | `Purged`, `FailedAndIsolated` | 다음 query·endpoint 등록 전에 완료 또는 격리 |
| `GetPwaCapability` Query | Web UI | registration·display mode snapshot | 설치·offline·push capability | 읽기 전용 |
| `HandleWorkerMessage` Event Handler | active client | versioned worker message | client refresh/update state | process-local |

production은 scope `/`에 통합 `sw.js` 하나만 등록한다. 기존 `/sw.js`와 `/firebase-messaging-sw.js`가 root scope를 경쟁하던 배포에서 초기화하더라도 후자는 폐기하고 한 registration이 fetch·push·notification click과 Firebase Messaging handoff를 담당한다. development에서는 새 worker를 등록하지 않으며, 로컬 테스트가 명시적으로 요청한 경우에만 이전 registration 정리를 수행한다.

### 3.2 Worker 계약

```ts
type WorkerMessageV1 =
  | { type: 'UPDATE_AVAILABLE'; workerVersion: string; cacheVersion: string }
  | { type: 'ACTIVATE_WAITING_WORKER'; workerVersion: string }
  | { type: 'WORKER_ACTIVATED'; workerVersion: string; cacheVersion: string }
  | { type: 'REFRESH_REQUIRED'; reason: 'CACHE_SCHEMA_CHANGED' | 'UPDATE_REQUIRED' }
  | { type: 'PURGE_SESSION_CACHE'; sessionGeneration: string }
  | { type: 'SESSION_CACHE_PURGED'; sessionGeneration: string }
  | { type: 'NOTIFICATION_CLICKED'; destination: string };
```

- `install`: versioned precache를 원자적으로 준비한 뒤 waiting 상태에서 client의 안전한 활성화 요청 또는 모든 구 client 종료를 기다린다. install 자체에서는 `skipWaiting()`하지 않는다.
- `activate`: 새 버전 cache 준비가 확인된 뒤 현재 version 밖의 이 모듈 cache를 삭제하고 `clientsClaim()`한다.
- `fetch`: build hash 정적 asset은 현재 version precache에서 제공한다. 동일 origin에서 사용자 데이터 없이 client bootstrap만 제공하는 navigation HTML은 `StaleWhileRevalidate`로, 공개 비민감 아이콘·폰트·이미지의 `GET` 성공 응답은 명시적 allowlist로 runtime cache하며 저장 시점부터 최대 7일 뒤 제거한다. `Set-Cookie`가 있거나 `Cache-Control: private|no-store`인 응답, `/api/**`, 인증 header·cookie가 있거나 가구·거래·자산·통계 데이터를 포함한 응답, 비 GET method와 임의 cross-origin 응답은 network-only로 처리한다. cache key에 UID·memberId·householdId·token을 넣지 않는다.
- `push`: Notifications v1 payload를 검증한 뒤 표시한다.
- `notificationclick`: 구조화 payload의 식별자를 단일 segment로 인코딩한 뒤 URL API로 정규화하고, 허용된 same-origin path prefix와 정확한 segment 수를 다시 검증한 destination만 기존 창 focus 또는 새 창으로 연다. dot·percent·이중 encoding·역슬래시 traversal은 decode 깊이와 무관하게 거부한다.

Firebase `register(messaging, { serviceWorkerRegistration, vapidKey })`에는 이미 등록된 root worker registration을 전달한다. Web과 worker의 Firebase public config는 같은 typed build source에서 생성하며 worker 파일에 설정 값을 hardcode하거나 compat SDK·deprecated `getToken`을 남기지 않는다. build는 생성된 실제 `/sw.js` artifact와 app SDK·worker Messaging SDK의 지원 matrix를 검사하고 맞지 않으면 배포 artifact 생성을 실패시킨다. 로그인한 iPhone 홈 화면 standalone PWA에서만 `onRegistered`로 받은 FID를 Notifications의 `RegisterEndpoint`로 전달한다. 로그아웃은 같은 설치의 `RemoveEndpoint`와 이전 session purge가 모두 성공해야 완료되며, 어느 하나라도 실패하면 이전 session을 격리하고 새 endpoint 등록을 차단한다. 다른 멤버 로그인은 두 정리가 성공한 뒤 현재 FID를 새 등록으로 전달한다. 별도 endpoint 멤버 전환 API는 호출하지 않는다. 인증되지 않은 iPhone, 홈 화면 밖 browser mode와 데스크톱에서는 messaging 권한 요청·등록을 시작하지 않으며 `firebase-messaging-sw.js`를 별도 root registration으로 만들지 않는다.

## 4. 플랫폼 상태와 불변식

| 상태·Policy | 불변식 |
|---|---|
| `WorkerIdentity` | origin+scope마다 active registration은 하나다. |
| `CacheVersion` | worker build와 호환되는 schema version을 포함한다. |
| `CachePolicy` | 인증·금융·API 응답과 임의 cross-origin 응답을 cache하지 않는다. build-versioned precache, 사용자 데이터 없는 동일 origin navigation shell의 `StaleWhileRevalidate`, 공개 아이콘·폰트·이미지의 최대 7일 runtime cache만 허용한다. |
| `SessionIsolationPolicy` | logout·인증 사용자 변경·household 변경은 이전 generation의 in-memory 응답·진행 중 요청·구독 namespace를 다음 query·endpoint 등록 전에 폐기한다. logout 성공 뒤에는 현재 generation이 없고, 사용자·가구 변경 성공만 명시된 새 generation을 연다. 공개 runtime cache는 actor와 무관하므로 generation에 귀속하지 않는다. generation에 귀속된 Cache Storage 항목은 원칙상 0건이어야 하며 발견되면 보안 계약 위반으로 삭제한다. |
| `FirebaseWorkerCompatibility` | Web config와 worker config는 같은 build 입력의 산출물이고 SDK 조합은 검증된 matrix 안에 있다. |
| `UpdatePolicy` | 새 worker는 waiting 상태로 설치한다. 미저장 입력이 없는 사용자의 갱신 동작 또는 모든 client 종료 뒤에만 활성화하며 시간 제한 강제 reload를 하지 않는다. |
| `NotificationNavigationPolicy` | route template과 인코딩한 identifier로 URL을 만든 뒤 URL 정규화 결과의 same-origin, 허용 prefix와 segment 수를 검증하며 payload URL과 traversal 표현을 신뢰하지 않는다. |
| `WebResponseSecurityPolicy` | production 응답에 최소 권한 CSP·`frame-ancestors 'none'`·nosniff·안전한 Referrer·Permissions header를 적용하고 HTTPS hosting에서 1년 이상의 HSTS를 적용한다. wildcard framing·unsafe script/connect·`unsafe-url`·`max-age=0`은 build 실패다. |

## 5. Application Use Case 상세

### 5.1 `InitializePwaRuntime`

1. `BuildEnvironmentPort`에서 production 여부를 읽는다.
2. development면 `DisabledInDevelopment`를 반환한다.
3. 현재 root-scope registration을 조회한다.
4. 기존 `/sw.js`와 `/firebase-messaging-sw.js` 충돌 fixture를 포함해 예상 script URL과 다른 root registration을 telemetry에 기록하고 통합 worker 하나로 교체한다.
5. registration을 Firebase Messaging FID Adapter에 전달한다.
6. active worker와 version handshake 후 `Ready` 또는 `UpdateAvailable`을 반환한다. registration 실패는 기능 없는 `Ready`로 숨기지 않고 `Failed`다.

### 5.2 Worker install·activate

1. install fixture 목록을 원자적으로 precache한다. 필수 asset 하나라도 실패하면 후보 cache 전체를 폐기하고 성공 install이나 부분 cache로 처리하지 않는다.
2. 설치가 끝나면 열린 client에 `UPDATE_AVAILABLE`을 알리고 waiting 상태를 유지한다. 기존 active worker가 현재 화면과 background push를 계속 담당한다.
3. client는 미저장 입력이 없을 때만 사용자의 갱신 선택을 받아 정확한 waiting version에 `ACTIVATE_WAITING_WORKER`를 보낸다. 미저장 입력이 있으면 저장 또는 명시적 폐기 전까지 전송하지 않는다.
4. worker는 요청이 화면이 관찰한 정확한 waiting version과 자신 모두에 일치할 때만 `skipWaiting()`하고, 모든 구 client가 종료된 경우에는 브라우저의 정상 lifecycle로 활성화된다.
5. activate에서 새 cache가 준비된 뒤 구 version cache를 정리하고 열린 client에 version을 broadcast한다.
6. 갱신을 선택한 client는 해당 전환의 `controllerchange`를 한 번만 소비해 reload한다. 다른 client를 강제 reload하지 않고 각 client가 갱신 안내를 유지하며, waiting 시간이 길어져도 timeout으로 활성화하거나 reload하지 않는다.
7. schema 비호환 write에 대한 서버의 `UPDATE_REQUIRED`는 입력을 유지한 명시적 갱신 안내로 전환하며, 구 client가 알 수 없는 schema를 추정해 재전송하지 않는다.

### 5.3 Push·click

1. versioned payload의 `version`, `notificationId`, `title`, `body`, `route.kind`, `route.identifier` 존재·타입·빈 값과 허용 route kind를 검증한다.
2. 알 수 없는 version·필수 필드 누락·타입 오류·허용하지 않은 route는 표시하지 않고 contract metric을 남긴다.
3. 표시 가능한 최소 payload만 Notification API에 전달한다.
4. payload의 route kind와 identifier를 schema 검증하고 URL API와 segment encoding으로 destination을 만든 뒤 정규화된 path prefix·segment 수를 검사한다. dot·percent·이중 encoding·역슬래시 traversal은 거부한다.
5. 일치하는 기존 client가 있으면 focus·navigate하고, 없으면 새 창을 연다.

### 5.4 세션 purge·응답 보안

1. logout·인증 사용자 변경·household 변경이 시작되면 client는 이전 `sessionGeneration`으로 `PurgePwaSession`을 호출한다. logout은 `nextGeneration`을 받지 않고, 사용자·가구 변경만 새 generation을 입력한다.
2. client는 해당 generation에 속한 in-memory 응답·진행 중 요청·구독 namespace를 결정적으로 폐기한다. worker는 Cache Storage에서 generation 귀속 항목이 0건인지 검사하고, 발견하면 보안 계약 위반으로 기록한 뒤 삭제한다. 공개 정적 runtime cache는 actor와 무관하므로 유지한다.
3. purge 실패 시 다음 Actor의 query와 endpoint 등록을 시작하지 않고 이전 namespace를 격리한 `FailedAndIsolated` 상태를 반환한다. logout 성공은 current generation을 `undefined`로 끝내며, 사용자·가구 변경 성공만 새 generation의 read gate를 연다.
4. iPhone endpoint가 있으면 `RemoveEndpoint` 성공 뒤 session purge를 완료하고 나서만 logout을 성공으로 반환한다. 삭제 또는 purge 실패 뒤 `RegisterEndpoint` 호출은 0건이다.
5. Next response Adapter는 build에서 생성한 `WebResponseSecurityPolicy`를 문서와 API 응답에 적용한다. CSP nonce/hash가 필요하면 동일 request scope에서 생성하고 설정 문자열을 화면 코드에 복제하지 않는다. header validator는 directive의 실제 허용 범위와 HSTS `max-age`를 검사한다.

## 6. Port 설계

| Port | Adapter | 테스트 대역 |
|---|---|---|
| `ServiceWorkerContainerPort` | Browser `navigator.serviceWorker` | registration lifecycle Fake |
| `WorkerCachePort` | Cache Storage | in-memory cache Fake |
| `ClientRegistryPort` | Worker Clients API | focus/open Spy |
| `NotificationDisplayPort` | ServiceWorkerRegistration | notification Spy |
| `MessagingRegistrationPort` | Firebase Messaging | registration capture Stub |
| `FirebaseWorkerConfigPort` | typed build-time config generator | Web/worker config equality fixture |
| `BuildEnvironmentPort` | Next build config | prod/dev fixture |
| `WebSecurityHeaderPort` | Next headers/middleware·hosting config | response header Spy |
| `PwaTelemetryPort` | Web observability | redacting Spy |

## 7. 저장·트랜잭션·동시성

- cache 이름은 `household-static-<cacheVersion>`과 `household-public-runtime-v1`처럼 소유자와 version을 포함해 결정적으로 만든다.
- install 중 필수 asset이 하나라도 실패한 후보 cache는 entry 일부를 포함해 전부 폐기하고 active allowlist에 넣지 않는다.
- activate 정리는 active build version을 제외한 이 모듈 소유 precache에만 적용한다. 공개 runtime cache는 entry별 저장 시각을 기준으로 7일이 지난 항목만 제거한다.
- 두 탭이 동시에 초기화해도 동일 script/scope registration을 재사용한다.
- worker update와 FCM FID 재등록은 별도 작업이며 registration handoff만 동기화한다.
- cache key에 사용자 UID·householdId 같은 개인정보를 평문으로 넣지 않는다. 세션 격리는 불투명 `sessionGeneration` namespace로 수행한다.
- logout은 `RemoveEndpoint`와 session purge가 모두 성공하기 전까지 완료되지 않는다. 두 단계 중 하나라도 실패하면 새 Actor의 query와 endpoint 등록을 시작하지 않으며, retry로 두 단계가 모두 성공한 뒤에만 재개한다.
- IndexedDB나 Cache Storage를 Canonical 금융 저장소 또는 offline command queue로 사용하지 않는다.
- 사용자 데이터 없는 동일 origin navigation shell은 이전 성공 HTML로 client bootstrap을 시작할 수 있지만, `/api/**`와 인증·가구·금융 응답은 offline fallback으로 이전 성공 응답을 돌려주지 않고 네트워크 실패를 그대로 반환한다.

## 8. Event·Projection·외부 연동

- worker/client message는 배포 내부 versioned contract이며 Outbox Event가 아니다.
- Notifications payload의 producer schema를 소비하되 수신자 계산을 복제하지 않는다.
- offline fetch 전략은 공개 Read Contract의 cache 허용 metadata를 소비한다.
- worker version, cache version, notification payload version을 독립 필드로 관측한다.

## 9. 오류·보안·관측성

- 등록·install·activate·push 계약 실패를 서로 다른 code로 기록한다.
- push payload의 임의 외부 URL, `javascript:` URL, dot·percent·이중 encoding·역슬래시 path traversal과 정규화 뒤 허용 prefix·segment shape를 벗어난 route를 거부한다.
- 인증 응답, 가구 key, 거래 상세가 runtime cache에 들어가는지 보안 E2E로 검사한다.
- CSP violation, 누락·불완전 보안 header, endpoint 삭제·session purge 실패와 Firebase config/version mismatch를 서로 다른 code로 기록한다.
- metric: active registration 수, worker version mismatch, install failure, stale cache count, push contract failure, click routing failure.
- production 초기화 실패를 단순 console log 뒤 성공으로 처리하지 않는다.

## 10. 목표 패키지 구조

```text
web/src/platform/pwa/
  application/initializePwaRuntime.ts
  application/purgePwaSession.ts
  ports/serviceWorkerContainer.ts
  policy/cachePolicy.ts
  policy/sessionIsolationPolicy.ts
  policy/notificationNavigationPolicy.ts
  policy/webResponseSecurityPolicy.ts
  adapters/browserServiceWorker.ts
  adapters/firebaseWorkerConfig.ts
web/src/platform/pwa/worker/
  sw.ts
  cacheHandlers.ts
  messagingHandlers.ts
  clientMessaging.ts
web/public/manifest.json
```

`next.config`는 worker build 연결만 담당하고 lifecycle 정책을 계산하지 않는다.

## 11. 테스트 설계

| 요구사항 ID | 수준 | 테스트 대상 | 핵심 fixture·경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| PWA-001 | I, E2E | 초기화·manifest | prod/dev, standalone, portrait | prod 한 registration·설치 가능, dev 비활성 | `T-PWA-INSTALL-001` |
| PWA-002 | Characterization I, E2E | 교체 전 install/activate Adapter | 열린 구 client, 미저장 form, 새 worker | 현재 즉시 활성화 동작만 전환 기간에 재현하며 목표 기대값과 분리 | `T-PWA-LEGACY-ACTIVATION-001` |
| PWA-003 | production E2E | 통합 worker·endpoint cleanup barrier | 기존 두 root script, fetch, background push, click, Messaging handoff, 삭제·purge 성공/실패, 비인증·browser·desktop | root registration 하나, 별도 Firebase worker 0건, 삭제와 purge 뒤에만 재등록 | T-PWA-001 |
| PWA-004 | 보안 I, production E2E | CachePolicy·PurgePwaSession | method, Set-Cookie, private/no-store, 개인정보 query, 인증·금융 응답, logout, 사용자·가구 변경, 진행 request·subscription, purge 실패 | 민감 응답·PII cache key 0건, logout generation 없음, 이전 state 제거 또는 query·endpoint 격리 | T-PWA-002 |
| PWA-005 | Contract, production build | Firebase worker config generator·실제 artifact | Web/worker config drift, 지원·미지원 SDK 조합, compat·deprecated API·설정 hardcode | 통합 `/sw.js`와 단일 산출 config, drift·미지원·hardcode 조합은 build 실패 | T-PWA-003 |
| PWA-006 | Unit, 보안 E2E | NotificationNavigationPolicy | `/`, `?`, `#`, Unicode, dot·percent·이중 encoding·역슬래시 traversal, 잘못된 template, 외부·javascript URL | 정규화 뒤 허용 prefix·segment shape인 route만 focus/open | T-PWA-004 |
| PWA-007 | Contract, 보안 E2E | WebResponseSecurityPolicy | document/API, wildcard framing, unsafe script/connect, unsafe referrer, HSTS 0 | directive 의미가 최소 권한인 header만 적용하고 불완전 정책은 build 실패 | T-PWA-005 |
| PWA-008 | Unit, Integration, production E2E | WorkerVersionHandshake·ActivationPolicy·CachePolicy | 정확한 waiting version, 미저장 form, 장기 waiting, 사용자 갱신, 모든 client 종료, 부분 precache 실패, controllerchange 중복, 7일 경계 | 부분 cache·강제 reload·입력 유실 없이 허용된 client만 한 번 전환하고 공개 runtime cache 유지 | T-PWA-006 |

추가 필수 시나리오:

- 두 탭 동시 초기화에도 root registration 한 개
- 기존 `sw.js`와 `firebase-messaging-sw.js` root 충돌 fixture를 통합한 뒤 Firebase Messaging이 동일 registration을 사용하는 contract test
- 알 수 없는 payload version과 외부 destination 차단
- 로그아웃 뒤 offline 재방문과 다른 사용자의 로그인에서 이전 가구 응답 부재
- offline 재방문과 cache version 변경 후 구 client 동작
- 생성 production artifact를 대상으로 한 Playwright + service-worker E2E

## 12. 확정 정책과 구현 순서

[DEC-051](../../../governance/decisions.md#dec-051)에 따라 새 worker는 waiting 상태로 설치하고, 미저장 입력이 없는 사용자의 갱신 선택 또는 모든 client 종료 뒤 재실행 때 활성화합니다. 금융·인증·API 응답과 임의 cross-origin 응답은 cache하지 않으며, 사용자 데이터 없는 동일 origin navigation shell과 공개 비민감 아이콘·폰트·이미지만 최대 7일 보존합니다.

worker 구현은 제품 결정이 아닙니다. 목표 구조는 하나의 root entry가 cache와 Firebase Messaging 수명주기를 조정하고, Workbox를 사용하더라도 generated worker를 별도 등록하지 않는 Composition Root로 고정합니다.

구현 순서:

1. 현재 production artifact에서 두 root worker 충돌을 재현하고 통합 뒤 root registration 하나·별도 Firebase worker 0건을 검증하는 `T-PWA-001`을 먼저 작성한다.
2. Firebase config generator와 SDK compatibility build test `T-PWA-003`을 추가한다.
3. 단일 worker entry와 Firebase registration handoff를 구현한다.
4. 민감 응답 deny-by-default CachePolicy, session purge와 안전한 click builder를 추가한다.
5. production 보안 header와 versioned cache·client handshake를 적용한다.
6. worker/client version handshake와 `T-PWA-006`을 활성화한다.
7. `T-PWA-001~006` 통과 뒤 별도 messaging worker 등록 코드와 worker 내부 설정 복사본을 제거한다.
