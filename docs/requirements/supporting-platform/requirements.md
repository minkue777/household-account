# 지원·읽기·플랫폼 요구사항 지도

> 문서 유형: Supporting / Read Side / Delivery Map  
> 소유 기능 모듈: Android Host, PWA, Reporting, Home Preferences, External Operations, Delivery Assurance  
> 소유 요구사항: 54개  
> 업무 Context: [5개 Bounded Context 인덱스](../README.md#2-5개-업무-bounded-context)

## 1. 목적

이 문서는 5개 업무 Bounded Context에 속하지 않는 전달·읽기·운영 기능을 한 곳에서 탐색하기 위한 지도다. 이 기능들을 여섯 번째 업무 Context로 만들지 않는다.

- Delivery Adapter는 업무 Context의 공개 계약을 사용자·OS·브라우저에 연결한다.
- Read Side는 원천 Aggregate를 수정하지 않고 Projection·화면 모델을 만든다.
- Operations는 Scheduler·retry·오류 분류·관측을 제공하되 업무 정책을 소유하지 않는다.

상세 요구사항과 테스트는 각 기능 모듈 문서가 한 번만 소유한다.

## 2. 기능 분류

| 분류 | 기능 모듈 | 요구사항 | 개수 | 책임 |
|---|---|---|---:|---|
| Delivery / Android | [Android Host](modules/android-host/requirements.md) | AND-*, QE-* | 23 | 권한, WebView, Bridge, QuickEdit UI |
| Delivery / Web | [PWA](modules/pwa/requirements.md) | PWA-* | 8 | 설치, cache/messaging worker 수명주기 |
| Read Side | [통계](modules/reporting/requirements.md) | STAT-*, STAT-AST-* | 9 | 거래·자산 통계 Projection |
| Read Side / Preferences | [홈 환경설정](modules/home-preferences/requirements.md) | HOME-*, THEME-* | 5 | 홈 카드·표시 지역화폐 구성과 Web local theme |
| Operations | [외부 운영](modules/external-operations/requirements.md) | JOB-ERR-*, EXT-* | 5 | 외부 오류 분류, job 결과, retry·관측 |
| Delivery Assurance | [배포 안전성](modules/delivery-assurance/requirements.md) | REL-* | 4 | test·Rules·환경·계약 호환 release gate |
| 합계 | 6개 기능 모듈 |  | 54 |  |

## 3. Delivery Adapter 경계

### Android Host

소비 계약:

- Access session/pairing
- Payment Capture queue·submit
- Ledger QuickEdit Command
- Notifications payload

소유 상태:

- WebView navigation과 환경별 origin allowlist
- OS 권한·QuickEdit 활성 상태
- Native session mirror와 local Queue의 기술 저장

금지:

- 거래 분할·삭제의 최종 업무 판정
- 알림 parser와 Merchant Rule 소유
- FCM 수신 대상 계산
- WebView origin 검증 없는 민감 Bridge 노출

### PWA

소비 계약:

- Web application route와 정적 asset
- Notifications payload와 click target

소유 상태:

- manifest
- cache/messaging을 조정하는 단일 service worker 수명주기
- cache version과 update 정책

PWA cache는 Canonical 업무 저장소가 아니다.

## 4. Read Side 경계

### Reporting

원천 계약:

- Household Finance의 Ledger·Category/Budget Query/Event
- Portfolio의 AssetSnapshot·Dividend Projection

불변식:

- 원천 Aggregate를 직접 수정하지 않는다.
- 기간·집계 정책은 Firestore·React와 분리한다.
- 영속 Projection에는 단일 Writer, checkpoint, rebuild 계약이 있다. DEC-048의 홈·예산·지출 통계처럼 요청 시 계산하는 View에는 Projection freshness를 만들지 않는다.
- 통계 화면의 거래 수정은 Ledger Command에 위임한다.

### Home Preferences

원천 계약:

- Ledger 월·연 합계
- Budget 잔여액
- LocalCurrencyBalance

소유 범위:

- 가구 또는 사용자 범위의 홈 카드 구성
- Web local theme와 CSS 변수 Adapter

테마는 업무 Domain이 아니며 Android QuickEdit 설정도 이 모듈이 소유하지 않는다.

## 5. Operations 경계

External Operations가 제공하는 것:

- `Success`, `NoData`, `RetryableFailure`, `ContractFailure`, `InvalidData` 결과 분류
- 업무 Application Command를 호출하는 Scheduler Inbound Adapter
- Portfolio 등 업무 Context가 정의한 retry executor·대상별 job-result sink Output Port 구현
- retry/backoff와 checkpoint 기술 구현
- 구조화 log, metric, trace correlation
- provider fixture contract test 지원

External Operations가 소유하지 않는 것:

- 자산 갱신 대상과 가치 계산
- 시세 Provider 선택의 업무 의미
- 자동 납입·상환 계산
- 배당 상태 전이
- Ledger·Notifications 재시도 정책의 업무 의미

각 업무 Context가 Output Port와 재시도 가능 의미를 정의하고 Operations Adapter가 이를 구현한다. Scheduler는 업무 Context가 소비하는 Output Port가 아니라 업무 Application을 호출하는 Inbound Adapter이며, 예약 시각·trigger 전달 뒤의 계산과 상태 전이는 해당 Context가 소유한다.

Delivery Assurance가 제공하는 것:

- 각 소유 모듈의 build·test·Rules Emulator·architecture·문서 추적 결과 조합
- DEC-050의 단일 production Firebase project와 로컬 Emulator를 구분하는 명시적 binding
- Web·Android·Functions·Rules 공유 계약의 호환 배포 순서와 rollback checkpoint
- artifact provenance, 배포 후 smoke와 Monitoring channel provision 검증

Delivery Assurance는 업무 테스트의 기대값을 다시 정의하거나 실패 suite를 통과로 바꾸지 않습니다. External Operations가 런타임 job·공급자 장애를 관측한다면, Delivery Assurance는 그 코드와 설정의 조합이 운영에 들어갈 자격을 검증합니다.

## 6. 제품 결정과 보안 경계

| 결정·정책 | 소유 기능 | 영향 |
|---|---|---|
| [DEC-004](../governance/decisions.md#dec-004) | Android Host | QuickEdit 사용 여부와 overlay 권한 |
| [DEC-008](../governance/decisions.md#dec-008) | Local Currency, Home 소비 | 홈 잔액 카드의 조회 key |
| [DEC-013](../governance/decisions.md#dec-013) | Ledger/Notifications, QuickEdit 소비 | Android 로컬 QuickEdit와 명시적 가구원 알림 요청 UI |
| AND-003 | Android Host | versioned 배포 설정의 WebView URL·origin allowlist |
| [DEC-045](../governance/decisions.md#dec-045) | Android Host | QuickEdit `FLAG_SECURE` 미적용과 화면 캡처 허용 |
| [DEC-046](../governance/decisions.md#dec-046) | External Operations·Delivery Assurance·공통 UoW | terminal 처리 기록 30일, unresolved 해결 전 보존, release manifest 장기 보존 |
| [DEC-049](../governance/decisions.md#dec-049) | External Operations | 시세 전체 갱신의 내부 50개 page·병렬 5·10초 timeout·총 3회·30초 single-flight |
| [DEC-050](../governance/decisions.md#dec-050) | Delivery Assurance | 단일 Cloud Firebase project 유지, Emulator 검증과 명시적 production binding |
| [DEC-051](../governance/decisions.md#dec-051) | PWA | 안전한 worker 활성화·reload UX, 금융 응답 비캐시, 공개 정적 자원 7일 보존 |
| [DEC-052](../governance/decisions.md#dec-052) | External Operations | 자산 자동화 매일 00:00 occurrence·checkpoint·실패 재시도; due 판정은 Portfolio 소유 |
| [DEC-054](../governance/decisions.md#dec-054) | Android Host | 연속 QuickEdit을 내구성 있는 FIFO로 보존하고 현재 항목부터 하나씩 표시 |
| [DEC-055](../governance/decisions.md#dec-055) | Android Host·Ledger | QuickEdit의 현재 미저장 form 전체를 원자 분할 초안으로 사용하고 version 충돌 시 전체 거부 |
| [DEC-057](../governance/decisions.md#dec-057) | Home Preferences·Ledger | 홈 선택 지역화폐 type 하나를 상세로 전달하고 내부 필터·legacy 임의 귀속을 두지 않음 |
| [DEC-058](../governance/decisions.md#dec-058) | Reporting·Portfolio | 선택 기간 Snapshot에 존재한 type·ownerRef를 현재 상태와 무관하게 과거 통계 필터에 표시 |
| [REL-001~004](modules/delivery-assurance/requirements.md#5-요구사항) | Delivery Assurance | release gate, 환경·project, 호환 배포, artifact·smoke |

## 7. 테스트 소유권

- [Android Host 테스트](modules/android-host/requirements.md#9-모듈-테스트-시나리오)
- [PWA 테스트](modules/pwa/requirements.md#9-모듈-테스트-시나리오)
- [Reporting 테스트](modules/reporting/requirements.md#8-모듈-테스트-시나리오)
- [Home Preferences 테스트](modules/home-preferences/requirements.md#8-모듈-테스트-시나리오)
- [External Operations 테스트](modules/external-operations/requirements.md#8-모듈-테스트-시나리오)
- [Delivery Assurance 테스트](modules/delivery-assurance/requirements.md#8-모듈-테스트-시나리오)

통합 경계 테스트:

- 허용하지 않은 WebView origin → 민감 capability 비노출
- 거래 Command 실패 → QuickEdit 성공 Toast·broadcast 없음
- cache worker와 messaging worker → 같은 scope에서 event 공존
- Projection Event 중복·순서 역전 → 조회 모델 수렴
- Provider 실패 → 0원·빈 성공과 구분
- 예약 job 일부 실패 → 성공·실패 대상과 재시도 범위 노출
- test/Rules/contract 하나 실패 또는 명시적 project 누락 → production deploy 0회
- Auth/Rules·FID client/server 순서가 호환 계획과 다름 → release candidate 거부

## 8. 변경 경계 확인

- Android 화면 변경이 Ledger Domain을 수정하지 않아야 한다.
- PWA cache 정책 변경이 Notifications 대상 정책을 수정하지 않아야 한다.
- 통계 차트 변경이 거래·자산 Canonical schema를 수정하지 않아야 한다.
- Scheduler 교체가 자산·배당 업무 계산을 수정하지 않아야 한다.
- 배포 workflow 교체가 업무 테스트 기대값이나 Context 구현을 수정하지 않아야 한다.
