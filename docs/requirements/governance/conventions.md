# 요구사항 문서 규약

> 상태: Active  
> 적용 범위: `docs/requirements` 아래의 모든 요구사항 문서  
> 목적: 5개 업무 Bounded Context 안에서 기능 모듈을 독립적으로 변경하면서 요구사항 ID, 근거, 테스트, 데이터 소유권의 단일 원본을 유지한다.

## 1. 문서 계층

```text
System Contract / Cross-cutting Policy
  → Business Bounded Context
    → Capability Module
      → Requirement ID / Test ID / Code Evidence

Supporting / Read Side / Delivery
  → Capability Module
    → Requirement ID / Test ID / Code Evidence
```

| 계층 | 책임 | 본문 소유 여부 |
|---|---|---|
| System Contract | 모든 Context가 지킬 최소 형식·오류·tenant 불변식 | SYS-*만 소유 |
| Bounded Context | 공통 언어, Aggregate, 일관성 경계, 공개 계약, 기능 모듈 지도 | 기능 요구사항 행을 소유하지 않음 |
| Capability Module | 독립 기능의 상세 요구사항, 결함, 테스트, 코드 근거 | 해당 ID의 단일 소유자 |
| Supporting Map | 업무 Context 밖의 Delivery·Read Side·Operations 지도 | 기능 요구사항 행을 소유하지 않음 |
| Cross-cutting Policy | 제품 결정, 보안, 데이터 소유권, 테스트 운영 | 해당 공통 정책만 소유 |

5개 업무 Context는 [현재 시스템 요구사항 인덱스](../README.md#2-5개-업무-bounded-context)가 정의한다.

## 2. 단일 소유 원칙

- 하나의 요구사항 ID는 정확히 하나의 기능 모듈 문서가 소유한다.
- 하나의 테스트 ID도 정확히 하나의 기능 또는 Cross-cutting 문서가 소유한다.
- 각 기능 모듈은 정확히 하나의 업무 Context 또는 지원·플랫폼 영역에 배치한다.
- Context 문서는 요구사항과 테스트 행을 복사하지 않고 ID 범위와 소유 문서 링크만 둔다.
- 공통 데이터 형식과 시스템 불변식은 [시스템 컨텍스트](../system/context.md)가 소유한다.
- 제품 결정은 [결정 기록](decisions.md)이 소유하며 정책 소유 Context는 하나만 둔다.
- 코드만으로 확정할 수 없는 질문은 [미결정 사항](pending-decisions.md)에 한 번만 기록하고 각 Context·상세 설계는 번호와 Policy 격리 지점만 링크한다.
- 논리 데이터·필드의 Writer와 Context 간 흐름은 [데이터 소유권](../cross-cutting/data-ownership.md)이 소유한다.
- 보안·개인정보 공통 정책은 [보안과 개인정보](../cross-cutting/security-privacy.md)가 소유한다.
- 전체 테스트 운영 원칙은 [테스트 전략](test-strategy.md)이 소유한다.

## 3. 요구사항 상태

| 상태 | 의미 | 테스트 원칙 |
|---|---|---|
| 현재 명세 | UI, 서비스, 호출 흐름이 일관되게 표현하는 사용자 기능 | 리팩토링 전에 명세 테스트를 작성한다. |
| 특성화 | 코드에서 관찰되지만 장기 제품 의도와 분리해야 하는 동작 | 임시 특성화 테스트로 보호하고 결정 후 수정한다. |
| 호환 | 기존 문서나 과거 입력 형식을 읽기 위한 동작 | 마이그레이션 종료 시점까지 회귀 테스트로 보호한다. |
| 결정 대기 | 제품 정책이 필요하여 코드만으로 확정할 수 없는 동작 | 선택 결과를 임의로 기대값으로 만들지 않고 데이터 무손실·권한·결정성 같은 선택 독립 불변식만 검증한다. |
| 결함 | 보안, 원자성, 오류 은폐 등 정상 요구사항으로 유지하면 안 되는 동작 | 잘못된 현재 결과가 아니라 교정할 불변식을 테스트한다. |
| 목표 명세 | 현재 코드에는 없거나 불완전하지만 확정된 결정·아키텍처상 반드시 구현해야 하는 동작 | 공개 계약과 목표 테스트를 먼저 작성하고 구현과 함께 활성화한다. |

## 4. 테스트 수준

| 표기 | 수준 | 대상 |
|---|---|---|
| U | Unit | 순수 계산, parser, Policy, Value Object |
| C | Contract | Context 공개 Port, Web·Android·Functions DTO, Event·오류 계약 |
| I | Integration | Repository, Unit of Work, Firestore·Functions Emulator |
| UI | Component / Android instrumentation | 화면 상태, 입력 검증, Bridge |
| E2E | End-to-End | 실제 사용자 흐름과 Context 간 경계 |

## 5. Bounded Context 문서 구조

Context 문서는 다음 내용을 갖는다.

1. 책임과 포함·제외 경계
2. 내부 기능 모듈과 요구사항 ID·개수
3. Ubiquitous Language
4. Aggregate와 논리 데이터 소유권
5. Context 전체 불변식과 일관성 경계
6. 공개 Command·Query·Event와 의존 방향
7. 대표 종단 흐름
8. 관련 제품 결정과 Human in the loop 질문
9. 하위 기능 테스트 링크와 Context contract test
10. 변경 경계 확인

Context 문서에는 상세 요구사항 문장, 코드 근거, 테스트 Given/When/Then을 복제하지 않는다.

## 6. 기능 모듈 문서 구조

각 기능 모듈은 요구사항과 상세 설계를 같은 디렉터리에서 관리한다.

```text
modules/<module>/
  requirements.md
  design.md
```

`requirements.md`는 제목 아래에 다음 metadata를 둔다.

- 상위 Bounded Context 또는 `없음 — 지원·플랫폼`
- 아키텍처 역할: Domain/Application, Workflow, Projection, Inbound Adapter, Platform 등
- Context 또는 지원 지도 링크

본문은 다음 순서를 사용한다.

1. 모듈 책임
2. 포함 범위와 제외 범위
3. 소유 데이터
4. 공개 계약과 의존 모듈
5. 요구사항
6. 현재 흐름
7. 정상 요구사항으로 고정하지 않을 결함
8. 관련 제품 결정
9. 테스트 시나리오
10. 코드 근거

섹션이 필요하지 않으면 생략할 수 있지만 요구사항, 결함, 결정, 테스트를 한 표에 섞지 않는다.

`design.md`는 [모듈 상세 설계 규약](module-design-standard.md)에 따라 공개 API, Domain 불변식, Use Case, Port, 저장·동시성 경계와 요구사항별 테스트 설계를 구체화한다. 요구사항 ID와 Canonical 테스트 ID를 새로 소유하거나 요구사항 문장을 복제하지 않는다.

## 7. 의존성 표기

| 표기 | 의미 |
|---|---|
| 소유 Context | 같은 공통 언어와 일관성 경계를 공유하는 업무 경계 |
| 소유 기능 모듈 | 데이터·필드와 변경 규칙을 최종 책임지는 capability |
| 제공 계약 | 다른 기능·Context가 호출할 수 있는 Application API 또는 Read Model |
| 소비 계약 | 이 기능이 필요로 하는 다른 기능·Context의 공개 계약 |
| Integration Event | commit된 사실을 Context 밖으로 전달하는 versioned Outbox Event |
| Projection | 원천 데이터·Event로 재구축 가능한 읽기 모델 |
| 외부 Adapter | Firebase, Android SDK, HTTP 공급자처럼 Domain 밖의 기술 경계 |

구현 파일 import 관계를 업무 의존성으로 간주하지 않는다. 문서에는 공개 계약과 데이터 흐름을 적는다.

다른 Context의 내부 Repository·Firestore 경로·Domain Entity 직접 접근은 금지한다. 같은 Context 내부 기능도 가능한 공개 Application Port를 사용하고, 강한 원자성이 필요한 명시적 Context Unit of Work만 예외로 문서화한다.

## 8. 요구사항 변경 규칙

1. 요구사항을 바꾸기 전에 상위 Context와 관련 DEC를 확인한다.
2. 상태·기대 결과·테스트·근거를 같은 변경에서 갱신한다.
3. 요구사항을 다른 기능으로 옮기면 기존 문서에서 제거하고 새 문서에 한 번만 둔다.
4. 기능 모듈의 Context가 바뀌면 두 Context 지도, 데이터 소유권, 종단 흐름을 함께 갱신한다.
5. 호환 요구사항을 제거할 때 데이터 migration과 회귀 fixture 제거 근거를 남긴다.
6. 결함을 해결하면 상태를 바로 현재 명세로 바꾸지 않고 구현과 검증 결과를 확인한다.
7. 결과가 확정된 목표 테스트는 공개 Subject와 assertion을 완성한 `describe.skip`으로 두고 구현 연결 시 활성화한다. 제품 결정이 남은 단일 시나리오에만 `test.todo`를 사용하며 둘 다 release 통과로 세지 않는다.
8. 제품 정책 변경은 DEC의 소유 Context와 영향 모듈을 함께 갱신한다.

## 9. 추적성

- 테스트 suite 이름에 요구사항 ID를 포함한다.
- Application Use Case 문서에 충족하는 요구사항 ID와 소유 Context를 기록한다.
- PR에는 변경한 Context·기능 요구사항, 추가 테스트, 폐기한 호환 동작을 적는다.
- Context 문서의 요구사항 개수 합계와 기능 문서의 고유 ID 합계를 비교한다.
- 각 기능 모듈이 정확히 한 Context 또는 지원 영역에 속하는지 검사한다.
- 제품 정책 변경은 DEC를 Accepted, Superseded 또는 Rejected로 갱신한다.
