# PWA 런타임 모듈 요구사항

> 상위 Bounded Context: 없음 — [지원·읽기·플랫폼 영역](../../requirements.md)  
> 아키텍처 역할: Web Delivery / Platform Adapter  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준 표기는 [공통 문서 규칙](../../../governance/conventions.md)을 따릅니다.

## 1. 독립 모듈 책임

이 모듈은 Web application을 설치 가능한 PWA로 제공하고 service worker 수명주기와 scope를 조정합니다. offline/cache worker와 FCM messaging worker가 동일한 origin에서 공존하도록 보장하며, 가계부 업무 규칙이나 푸시 대상 계산은 소유하지 않습니다.

## 2. 포함·제외 범위

포함 범위:

- production PWA build 활성화와 development 비활성화
- Web app manifest, standalone 표시, 세로 방향 설치 metadata
- service worker 등록·활성화·업데이트 정책
- cache worker와 messaging worker의 scope·event 공존
- 인증·가구·금융 응답의 cache 금지와 로그아웃·세션 교체 시 session-derived cache 정리
- Firebase Web·worker 설정의 단일 원본과 worker SDK 호환성 검증
- 알림 클릭의 same-origin 안전 경로 생성
- Web 응답의 기본 보안 header 정책
- iPhone 홈 화면 PWA의 로그인 후 FID callback 전달과 로그아웃 endpoint 삭제 요청
- production에서 페이지 로드, cache, push, notification click의 통합 회귀 보호

제외 범위:

- 자산·거래·가구 등 Web 업무 화면과 Domain 규칙
- FCM FID endpoint의 서버 저장·binding·알림 대상 계산
- notification payload 업무 의미
- Android WebView와 Native bridge
- cache에 저장할 업무 데이터의 별도 schema migration 정책

## 3. 소유 데이터

| 데이터 | 이 모듈의 권한 | 비고 |
|---|---|---|
| Web app manifest | 소유 | 설치 이름, 표시 방식, 방향, icon metadata를 포함합니다. |
| service worker 등록·scope 구성 | 소유 | cache와 messaging 기능의 공존을 보장합니다. |
| cache version과 정적 asset cache | 소유 | 업무 원본 데이터의 권위 저장소가 아닙니다. |
| cache 허용 목록과 session purge 정책 | 소유 | 인증·가구·금융 응답은 저장하지 않고 세션 경계에서 파생 cache를 폐기합니다. |
| Web 보안 header 구성 | 소유 | CSP와 브라우저 보안 header를 배포 artifact에 적용합니다. |
| FCM FID endpoint·알림 event | 비소유 | 푸시 알림 모듈이 소유합니다. |

## 4. 공개 계약·의존 모듈

공개 계약은 production Web client가 하나의 일관된 service worker 전략 아래 설치, 페이지 로드, 업데이트, cache, background push, notification click을 모두 사용할 수 있다는 것입니다. worker 변경은 cache schema·payload version과 함께 호환성을 검증해야 합니다.

의존 모듈:

- [푸시 알림](../../../contexts/notifications/modules/notifications/requirements.md): messaging worker payload와 클릭 목적지 계약
- Web deployment configuration: production/development 환경 판별과 asset base URL
- Browser Service Worker API: registration, activation, scope, clients focus/openWindow
- [Android Host](../android-host/requirements.md): WebView에서는 PWA 설치 기능이 아니라 동일 Web application을 소비하며 worker 정책 차이를 별도 검증

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| PWA-001 | 현재 명세 | production에서 서비스 워커를 등록하고 standalone·세로 방향 PWA로 설치할 수 있다. | 개발 환경에서는 PWA를 끈다. | [Next config](../../../../../web/next.config.js), [manifest](../../../../../web/public/manifest.json) | I, E2E |
| PWA-002 | 특성화 | 현재 새 서비스 워커는 `skipWaiting`으로 대기 없이 활성화한다. | 열린 client의 미저장 form·schema 호환을 확인하지 않는 현재 동작은 목표 정책이 아니며 PWA-008로 교체한다. 기존 artifact 회귀를 설명하는 특성화 fixture로만 유지한다. | [Next config](../../../../../web/next.config.js) | I, E2E |
| PWA-003 | 결함 | production origin의 root scope에는 active service worker가 하나만 존재하고 그 worker가 캐시·푸시·클릭 동작과 Firebase Messaging registration handoff를 함께 제공해야 한다. 로그인한 iPhone 홈 화면 PWA만 FID를 Notifications에 전달하며, 로그아웃의 `RemoveEndpoint` 성공과 이전 session purge 성공 뒤에만 다른 로그인 endpoint를 등록한다. | 현재 sw.js와 firebase-messaging-sw.js가 모두 기본 root scope를 등록할 수 있다. endpoint 삭제 또는 session purge가 실패하면 이전 session을 격리하고 새 endpoint 등록을 0건으로 유지한다. 인증되지 않은 iPhone, 홈 화면 밖 browser mode와 데스크톱은 알림 권한 요청·FID 등록·endpoint 생성 대상이 아니다. | [Next config](../../../../../web/next.config.js), [pushNotificationService](../../../../../web/src/lib/pushNotificationService.ts), [DEC-020](../../../governance/decisions.md#dec-020) | production E2E |
| PWA-004 | 목표 명세 | 인증 응답, 가구별 응답, 거래·자산 등 금융 응답은 Cache Storage에 저장하지 않으며 로그아웃·인증 사용자 변경·가구 변경 시 해당 세션에서 파생된 runtime cache와 client 상태를 폐기한다. | 공개 정적 asset의 `GET` 성공 응답만 명시적 allowlist로 최대 7일 cache하며 `Set-Cookie`, `private`, `no-store`와 개인정보 cache key를 거부한다. logout 성공 뒤 `sessionGeneration`은 없고, 사용자·가구 변경 성공만 새 generation을 연다. 진행 중 request·subscription도 폐기하며 purge 실패는 다음 query·endpoint 등록 전에 격리한다. | [Next config](../../../../../web/next.config.js), [서비스 worker](../../../../../web/public/firebase-messaging-sw.js) | 보안 I, production E2E |
| PWA-005 | 결함 | Firebase project 설정은 Web client와 통합 worker가 같은 빌드 단일 원본에서 받고, 생성된 실제 worker artifact의 Messaging SDK는 애플리케이션 SDK와 지원되는 호환 조합으로 검증한다. | 현재 worker가 Firebase compat 9.0.0과 설정 값을 별도로 고정해 Web 설정과 독립적으로 drift할 수 있다. 통합 `/sw.js`에는 compat SDK, deprecated token API, Firebase 설정 값 hardcode를 남기지 않으며 별도 `/firebase-messaging-sw.js`를 산출하지 않는다. 비밀값 저장 요구가 아니라 설정 일치·배포 계약이다. | [Web Firebase 설정](../../../../../web/src/lib/firebase.ts), [messaging worker](../../../../../web/public/firebase-messaging-sw.js) | C, production E2E |
| PWA-006 | 결함 | 알림 클릭 목적지는 구조화된 route와 안전하게 인코딩한 식별자로 생성하고, URL 정규화 뒤에도 허용된 same-origin path prefix와 정확한 segment 수를 만족할 때만 focus·open한다. | payload의 URL 문자열을 그대로 열지 않는다. `/`, `?`, `#`, Unicode는 단일 segment로 인코딩하되 `.`, `..`, percent·이중 percent encoding과 역슬래시를 이용한 traversal은 거부한다. | [messaging worker](../../../../../web/public/firebase-messaging-sw.js) | U, 보안 E2E |
| PWA-007 | 결함 | production Web 응답은 최소 권한 CSP, `frame-ancestors`, `X-Content-Type-Options`, Referrer-Policy, Permissions-Policy를 적용하고 HTTPS 배포는 유효한 HSTS를 적용한다. | header 이름 존재만으로 통과시키지 않는다. wildcard framing, unsafe script, 무제한 connect, `unsafe-url`, `max-age=0` HSTS처럼 효과가 없거나 과도한 정책은 production build를 실패시킨다. | [Next config](../../../../../web/next.config.js) | C, 보안 E2E |
| PWA-008 | 목표 명세 | 새 worker는 필수 정적 asset 준비 뒤 waiting 상태로 두고, 열린 화면을 강제로 장악하거나 시간 제한으로 reload하지 않는다. 미저장 입력이 없고 사용자가 갱신을 선택하면 활성화 후 한 번만 reload하며, 모든 화면을 닫고 다시 실행해도 새 버전을 사용한다. | 미저장 입력이 있으면 저장 또는 명시적 폐기 전까지 갱신을 미룬다. 비호환 write는 서버가 `UPDATE_REQUIRED`로 거부하고 client는 입력을 보존한 채 갱신을 안내한다. 공개 비민감 아이콘·폰트·이미지만 allowlist로 최대 7일 runtime cache하며 금융·인증·API·navigation HTML과 임의 cross-origin 응답은 cache하지 않는다. [DEC-051](../../../governance/decisions.md#dec-051) | [Next config](../../../../../web/next.config.js), [service worker](../../../../../web/public/firebase-messaging-sw.js) | U, I, production E2E |

## 7. 정상 요구사항으로 고정하지 않을 결함

- PWA cache worker와 Firebase messaging worker가 같은 root scope에 각각 등록되어 서로를 대체할 수 있습니다.
- 새 worker를 즉시 활성화하므로 runtime cache나 client code가 구 schema와 함께 남는 경우 호환성 문제가 발생할 수 있습니다.
- development에서 PWA가 꺼져 있어 worker 충돌은 production E2E가 없으면 발견하기 어렵습니다.
- cache·push·notification click을 하나의 배포 시나리오로 검증하는 자동화가 없습니다.
- Web Firebase 설정과 worker의 Firebase 설정·SDK version이 중복되어 독립적으로 변경될 수 있습니다. (`PWA-005`)
- notification click이 raw expense ID를 route 문자열에 보간하고 있습니다. (`PWA-006`)
- production Web 보안 header 계약이 배포 구성에 없습니다. (`PWA-007`)

## 8. 관련 제품 결정

| 결정 | 상태 | 이 모듈에 미치는 영향 |
|---|---|---|
| [DEC-019](../../../governance/decisions.md#dec-019) | 확정 | registration token 대신 FID callback을 Notifications Adapter에 전달합니다. |
| [DEC-020](../../../governance/decisions.md#dec-020) | 확정 | iPhone 홈 화면 PWA만 로그인 등록·로그아웃 삭제에 참여하고 데스크톱은 알림에서 제외합니다. |
| [DEC-051](../../../governance/decisions.md#dec-051) | 확정 | 새 worker의 안전한 활성화와 reload, 금융 응답 비캐시, 공개 정적 자원의 최대 7일 보존을 적용합니다. |

root scope의 worker는 cache와 messaging을 조정하는 단일 Composition Root로 고정합니다. [DEC-051](../../../governance/decisions.md#dec-051)에 따라 새 버전은 waiting 상태에서 안전한 재실행 또는 사용자 갱신을 기다리고, 금융·인증·API·navigation HTML은 cache하지 않으며 공개 비민감 아이콘·폰트·이미지만 최대 7일 보존합니다.

## 9. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-PWA-INSTALL-001 | 현재 명세 | production/development, standalone·portrait·root scope·설치 icon 정상/결함 / PWA bootstrap / production만 설치 가능한 metadata와 root worker 하나, development 비활성, 결함은 typed configuration 거부 | PWA-001 |
| T-PWA-LEGACY-ACTIVATION-001 | 특성화 | 구 worker와 미저장 form이 열린 기존 artifact / 새 worker 설치 / 입력 여부를 확인하지 않은 즉시 활성화 동작을 전환 기간에만 재현 | PWA-002 |
| T-PWA-001 | 목표 | 기존 `sw.js`·`firebase-messaging-sw.js` root 충돌과 production PWA 초기화 / 페이지·cache·푸시·클릭·Messaging handoff, 로그인·로그아웃·재로그인 / 통합 root registration 하나만 남고 endpoint 삭제와 session purge가 모두 성공한 뒤에만 새 endpoint 등록 | PWA-003 |
| T-PWA-002 | 목표·보안 | 인증·가구·금융 응답과 공개 asset을 조회한 세션 / offline 재방문과 로그아웃·사용자·가구 변경·purge 실패 / 민감 응답과 개인정보 cache key는 없고 request·subscription을 포함한 이전 파생 상태가 제거되며 logout에는 새 generation이 없음 | PWA-004 |
| T-PWA-003 | 목표·계약 | Web과 worker production build / Firebase 설정·SDK 호환 검증 / 동일 project 설정이 한 번 주입되고 지원하지 않는 version 조합은 build 실패 | PWA-005 |
| T-PWA-004 | 목표·보안 | `/`, `?`, `#`, Unicode, dot·percent·이중 encoding·역슬래시 traversal과 잘못된 template / notification click / URL 정규화 뒤 허용된 same-origin prefix·segment shape만 focus·open | PWA-006 |
| T-PWA-005 | 목표·보안 | production 배포 응답과 불완전 정책 fixture / 문서·API header의 directive 의미 검사 / 최소 권한 정책만 적용되고 wildcard·unsafe·무효 HSTS는 build 실패 | PWA-007 |
| T-PWA-006 | 목표 | 구 client에 미저장 form 있음·없음과 호환/비호환 schema worker 대기 / 사용자 갱신·모든 화면 종료 후 재실행·write / form 유실과 강제 reload가 없고, 허용 시 한 번만 reload하며 비호환 write는 `UPDATE_REQUIRED` | PWA-008, DEC-051 |

추가 production E2E에서는 최초 설치, 기존 client가 열린 상태의 worker 갱신, 로그인 FID 등록, 로그아웃 endpoint 삭제, 다른 멤버 로그인 등록, 데스크톱 미등록, offline 재방문, background push 표시, 알림 클릭의 기존 창 focus, 새 창 open, cache version 변경을 같은 배포 artifact로 검증합니다.

## 10. 코드 근거

- [Next PWA 구성](../../../../../web/next.config.js)
- [Web app manifest](../../../../../web/public/manifest.json)
- [Firebase messaging service worker](../../../../../web/public/firebase-messaging-sw.js)
- [Web 푸시 서비스](../../../../../web/src/lib/pushNotificationService.ts)
- [생성되는 cache worker 진입 경로](../../../../../web/public)
