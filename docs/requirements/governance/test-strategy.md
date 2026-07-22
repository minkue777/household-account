# 요구사항 기반 테스트 전략

> 상태 규약: [요구사항 문서 규약](conventions.md)  
> Context 지도: [5개 업무 Bounded Context](../README.md#2-5개-업무-bounded-context)  
> 목적: Context 경계를 검증하면서 상세 테스트는 기능 모듈이 독립적으로 소유하도록 한다.

## 1. 테스트 계층과 소유권

| 테스트 범위 | 단일 소유자 | 예시 |
|---|---|---|
| 기능 내부 정책·유스케이스 | Capability Module | 월 분할, parser, 카드 matching, 배당 전이 |
| 같은 Context 내부 여러 기능의 원자성·계약 | 해당 Context의 주 기능 모듈 | Recurring plan + Ledger posting |
| Context 간 공개 계약 | 결과를 보장하는 제공 Context | Payment Capture fingerprint 의미, Ledger claim 원자성 |
| Cross-cutting 보안·tenant 경계 | [보안과 개인정보](../cross-cutting/security-privacy.md) | 가구 간 Rules, 무인증 서버 Command |
| Delivery E2E | 지원·플랫폼 기능 | WebView, PWA worker, QuickEdit |
| Release gate·환경·호환 배포 | [배포 안전성](../supporting-platform/modules/delivery-assurance/requirements.md) | 명시적 project, Rules/index, FID/Auth 호환 순서, smoke |

- 하나의 테스트 ID는 정확히 하나의 기능 또는 Cross-cutting 문서에만 존재한다.
- Context 문서는 테스트 Given/When/Then을 복사하지 않고 하위 소유 문서 링크와 Context 경계 검증 목록만 둔다.
- 소비자 테스트는 제공자의 Domain 동작을 다시 구현하지 않고 공개 계약 fixture를 사용한다.
- 의미가 같은 E2E·보안 시나리오가 여러 기능에 필요하면 Canonical 테스트 한 곳을 소유자로 두고 다른 문서는 링크한다.

현재 고유 Canonical 테스트 ID는 업무 150개, 지원·플랫폼 51개, 공통 System 7개와 공통 보안 2개로 총 210개입니다.

## 2. 원칙

1. 요구사항 ID를 테스트 이름에 포함한다.
2. 순수 업무 규칙은 Firebase, React, Android SDK 없이 실행한다.
3. Context 공개 계약과 Web·Android·Functions DTO는 같은 JSON fixture로 검증한다.
4. Firestore 변경은 Emulator에서 성공·재시도·경합·부분 실패를 검증한다.
5. 결함은 잘못된 현재 결과를 영구 고정하지 않고 교정할 불변식을 목표 테스트로 표현한다.
6. 외부 HTTP·HTML은 기록된 fixture로 계약을 검증하고 live smoke test는 별도로 둔다.
7. Clock, timezone, 현재 날짜, ID 생성기, transaction runner를 주입한다.
8. Transaction callback은 여러 번 실행될 수 있다는 Fake로 side effect 안전성을 검증한다.
9. Outbox Consumer는 Event 중복·순서 역전·이전 version·dead letter를 검증한다.
10. 영속 Projection은 전체 rebuild, checkpoint와 원천 합계를 검증하고, 조회 시 계산 View는 다중 page 완전성·부분 결과 금지·NoData/실패 구분을 검증한다.
11. 제품 결과가 확정됐지만 목표 Input Port가 아직 없으면 공개 Subject와 assertion을 완성한 `describe.skip`으로 기록하고, 제품 결정 자체가 남은 단일 시나리오에만 `test.todo`를 사용한다. 둘 다 release pass로 세지 않는다.
12. client 비동기 테스트는 SessionScope 전환과 늦은 callback을 포함하고, 외부 HTTP 테스트는 인증·입력 상한·SSRF·timeout을 Provider 호출 전 경계에서 검증한다.
13. compile 성공과 skip된 suite는 release pass가 아니다. [REL-001](../supporting-platform/modules/delivery-assurance/requirements.md#5-요구사항)이 요구한 모든 gate의 결과가 있어야 한다.
14. 목표 Functions Domain·Application 계약은 Node 환경 Vitest로 실행하고, Web의 Next/Jest와 분리한다. 구현 전 완성된 `describe.skip` suite와 active suite의 수를 결과에 함께 기록한다.
15. 공용 wire fixture는 루트 `contracts/`에 두고 둘 이상의 런타임이 같은 expected 결과를 읽는다. 단일 모듈 Domain fixture는 해당 모듈 테스트가 소유한다.

## 3. 우선순위

| 우선순위 | 소유 Context·영역 | 테스트 묶음 | 요구사항 | 이유 |
|---|---|---|---|---|
| P0 | Household Finance / Payment Capture / Android Delivery | 분할 계산 정책과 취소·QuickEdit 원자성·입력 보존 | SPL-001~006, MRG-001~002, CAN-004~007, QE-005~010 | DEC-001 회귀와 부분 삭제·연속 입력 유실 방지 |
| P0 | Payment Capture | Android parser golden fixture 기반 parser conformance | PARSE-* | 비식별 raw fixture는 작성됐고 목표 parser 연결·회귀 검증이 필요 |
| P0 | Payment Capture + Finance | 카드·가맹점·fingerprint·원자 거래 생성 | MER-*, CARD-004, ING-SAVE-*, IOS-006, IOS-011 | 채널 간 중복 판정 제거와 동시 요청 방지 |
| P0 | Access / Cross-cutting | 인증·가구 격리 | SYS-001, HH-*, ADM-002, IOS-010, PUSH-009, AND-006 | 외부 공유 전 필수 |
| P0 | 공통 시스템 / Web·Android | SessionScope·migration 격리 | SYS-008~009 | 가구 전환 누출과 client 전역 보정 차단 |
| P0 | Notifications | endpoint·대상·전달 멱등성·제거 멤버 차단·가구 purge | PUSH-001~013 | 거래 성공과 알림 결과 분리, 제거 cleanup 지연 중 발송 방지, 대상 가구 page 삭제 멱등성 |
| P0 | Delivery Assurance | 배포 gate·환경·호환 순서 | REL-* | Rules 선차단·FID 부분 배포와 운영 오배포 방지 |
| P1 | Household Finance | 정기 거래 멱등성 | REC-* | 월 경계와 Finance Unit of Work |
| P1 | Portfolio | 자동 납입·상환과 자산 평가 | AUTO-*, LOAN-*, AST-*, HOLD-003, JOB-AST-* | 재실행 안정성과 단일 Asset Writer |
| P1 | Portfolio | 배당 상태 전이 | DIV-*, JOB-DIV-* | 날짜·보유수량 기반 계산 |
| P1 | Operations | Repository·Provider 오류·HTTP 경계 계약 | SYS-007, JOB-ERR-*, EXT-* | 빈 데이터·0원·실패, API 남용·SSRF·미실행 job 구분 |
| P2 | 지원·플랫폼 | 화면·PWA·Bridge E2E | LED-*, STAT-*, PWA-*, AND-* | 핵심 Context 안정화 후 UI 회귀 보호 |

## 4. Context별 테스트 카탈로그

### 4.1 업무 Context

| Bounded Context | 요구사항 | Test ID 개수 | 테스트 소유 기능 문서 |
|---|---:|---:|---|
| [Access & Household](../contexts/access-household/requirements.md) | 17 | 13 | [가구와 접근](../contexts/access-household/modules/household-access/requirements.md#8-모듈-테스트-시나리오) |
| [Household Finance](../contexts/household-finance/requirements.md) | 39 | 44 | [원장](../contexts/household-finance/modules/ledger/requirements.md#8-모듈-테스트-시나리오), [카테고리·예산](../contexts/household-finance/modules/categories-budget/requirements.md#8-모듈-테스트-시나리오), [정기 거래](../contexts/household-finance/modules/recurring-transactions/requirements.md#8-모듈-테스트-시나리오), [지역화폐](../contexts/household-finance/modules/local-currency/requirements.md#8-모듈-테스트-시나리오) |
| [Payment Capture](../contexts/payment-capture/requirements.md) | 63 | 47 | [결제 설정](../contexts/payment-capture/modules/payment-configuration/requirements.md#8-모듈-테스트-시나리오), [Android 수집](../contexts/payment-capture/modules/android-payment-ingestion/requirements.md#9-모듈-테스트-시나리오), [Shortcut](../contexts/payment-capture/modules/shortcut-ingestion/requirements.md#9-모듈-테스트-시나리오) |
| [Portfolio](../contexts/portfolio/requirements.md) | 38 | 35 | [포트폴리오](../contexts/portfolio/modules/portfolio/requirements.md#8-모듈-테스트-시나리오), [보유종목·시세](../contexts/portfolio/modules/holdings-market-data/requirements.md#8-모듈-테스트-시나리오), [자동화](../contexts/portfolio/modules/asset-automation/requirements.md#8-모듈-테스트-시나리오), [배당](../contexts/portfolio/modules/dividends/requirements.md#8-모듈-테스트-시나리오) |
| [Notifications](../contexts/notifications/requirements.md) | 13 | 12 | [푸시 알림](../contexts/notifications/modules/notifications/requirements.md#9-모듈-테스트-시나리오) |
| 합계 | 170 | 151 | 13개 기능 모듈 |

모든 업무 Context 요구사항은 이름이 부여된 Canonical 테스트와 실제 계약 assertion 본문에 연결되어 있습니다. Architecture traceability gate가 이 연결을 양방향으로 검사합니다.

### 4.2 지원·플랫폼과 Cross-cutting

| 영역 | 요구사항 | Test ID 개수 | 테스트 소유 문서 |
|---|---:|---:|---|
| [지원·읽기·플랫폼](../supporting-platform/requirements.md) | 53 | 51 | [Android Host](../supporting-platform/modules/android-host/requirements.md#9-모듈-테스트-시나리오), [PWA](../supporting-platform/modules/pwa/requirements.md#9-모듈-테스트-시나리오), [Reporting](../supporting-platform/modules/reporting/requirements.md#8-모듈-테스트-시나리오), [Home](../supporting-platform/modules/home-preferences/requirements.md#8-모듈-테스트-시나리오), [Operations](../supporting-platform/modules/external-operations/requirements.md#8-모듈-테스트-시나리오), [Delivery Assurance](../supporting-platform/modules/delivery-assurance/requirements.md#8-모듈-테스트-시나리오) |
| [공통 System](../system/context.md) | 9 | 7 | [공통 시스템 상세 설계](../system/design.md#11-테스트-설계) |
| [공통 보안](../cross-cutting/security-privacy.md#7-보안-테스트-행렬) | SYS·보안 영향 요구사항 | 2 | T-SEC-001, T-SEC-002 |
| 합계 | 62 + 공통 보안 | 60 |  |

### 4.3 Canonical 소유권 확정

의미가 가까운 시나리오는 다음처럼 경계를 나눠 소유권을 확정했습니다.

- `T-SEC-001`은 전체 tenant CRUD 권한 행렬을, `T-HH-RULES-001`은 Access가 제공하는 가구 범위 Actor 계약을 소유합니다.
- `T-SEC-002`는 여러 무인증 진입점의 공통 종단 행렬을, `T-HH-SEC-001`·`T-IOS-SEC-001`·`T-PUSH-SEC-001`은 각 기능 입력의 typed 결과와 무변경 상태를 소유합니다.
- `T-PUSH-002`는 알림 대상 계산을, `T-REC-PUSH-001`은 정기 거래가 자동 알림 요청을 만들지 않는 제공 Context 결과를 소유합니다.

Architecture traceability gate가 Canonical ID의 중복 선언, 요구사항 연결 누락과 테스트 소스 누락을 자동으로 거부합니다.

## 5. 현재 검증 기준

테스트 개수처럼 구현과 함께 바뀌는 숫자는 문서에 고정하지 않습니다. 현재 상태는 다음 검증 관문을 모두 통과했는지로 판단합니다.

- Functions: 계약 테스트, Architecture gate, runtime boundary, TypeScript build
- Web: 단위·통합 테스트와 production build
- Android: JVM 테스트, lint와 APK build
- Firebase: Firestore·Storage Rules emulator 테스트와 배포 전 검증

정확한 명령과 테스트 구성은 [Functions 테스트 안내](../../../functions/test/README.md), 자동 실행 기준은 [quality-gates workflow](../../../.github/workflows/quality-gates.yml)를 단일 실행 근거로 사용합니다. 실패한 기존 테스트는 구현을 되돌려 억지로 통과시키지 않고 현재 요구사항·호환 정책에 따라 수정하거나 제거합니다.

## 6. 테스트를 가능하게 하는 최소 seam

1. Cloud Function wrapper와 Application handler를 분리한다.
2. Firestore, Messaging, 외부 HTTP Provider, Clock, ID 생성기, UnitOfWork를 handler에 주입한다.
3. Shortcut parser·owner 선택·자산 집계·배당 전이 같은 순수 Policy를 Framework 밖으로 분리한다.
4. Firestore Rules는 `@firebase/rules-unit-testing`과 Emulator로 검증한다.
5. FCM Emulator는 없으므로 Messaging Port Fake로 대상·payload·오류 분류를 검증한다.
6. Scheduler cron과 업무 job handler를 분리하고 같은 실행 key 재시도를 검증한다.
7. KIND·Naver·Nasdaq·Upbit 응답은 정상, NoData, 일시 실패, 비정상 숫자, 계약 변경 fixture를 둔다.
8. Repository Fake와 Firestore Adapter에 같은 재사용 Conformance Suite를 실행한다.
9. Outbox Dispatcher와 Consumer Inbox를 Fake clock·중복 Event로 검증한다.
10. Web·Android composition에 `ClientSessionScopeProvider`와 subscription/request registry를 주입해 A→B 전환과 늦은 A 응답을 결정적으로 재현한다.
11. 외부 Adapter는 `SafeExternalHttpClientPort`와 Web API Ingress Fake 뒤에 두어 무인증·초과 batch·악성 redirect에서 Provider 호출이 0회인지 검증한다.
12. release manifest, project binding, compatibility checker와 deploy/smoke Port를 분리해 production write 없이 배포 순서를 검증한다.

이 seam 추출은 기능 변경이 아니라 현재 동작에 테스트를 붙이기 위한 준비 단계다.

## 7. 기능·Context 리팩토링 시작 조건

1. 기능 모듈의 상위 Context와 아키텍처 역할이 표시되어 있다.
2. 현재 명세와 Pending DEC가 식별되어 있다.
3. 정상·호환 동작에 기능 단위 테스트가 있다.
4. 결함의 교정 불변식이 목표 테스트로 표현되어 있다.
5. Context 공개 Input/Output Port와 typed error가 정의되어 있다.
6. Aggregate와 최종 Writer, 강한 원자성·Outbox·Projection 경계가 정해져 있다.
7. Context를 넘는 동기 호출과 Event를 구분했다.
8. 기존 Web·Android·Functions 호출자를 Facade 또는 Adapter 뒤에 유지할 수 있다.
9. 관련 Context contract test와 Cross-cutting 보안 test가 준비되어 있다.
10. client scope, migration/repair, 외부 HTTP 또는 공유 wire contract를 바꾸면 해당 release compatibility·security gate가 준비되어 있다.

## 8. CI 순서

1. Domain unit test
2. Application use case test
3. 공유 fixture·producer/consumer contract test
4. Architecture dependency test
5. Web·Functions TypeScript 검사
6. Android JVM test
7. Firestore Rules·Repository·Functions Emulator integration
8. Outbox/Projection rebuild·경합 test
9. Web component test
10. Android instrumentation
11. production build, PWA·권한·알림 E2E
12. 요구사항 ID·상대 링크·환경/project binding·compatibility manifest·post-deploy smoke gate
