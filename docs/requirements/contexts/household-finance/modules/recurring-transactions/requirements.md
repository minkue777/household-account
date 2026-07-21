# 정기 거래 모듈 요구사항

> 상위 Bounded Context: [Household Finance](../../requirements.md)  
> 아키텍처 역할: Domain / Application Workflow  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준의 의미는 [공통 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `REC-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

정기 거래 모듈은 사용자가 정의한 월간 정기지출 일정과 해당 일정의 처리 상태를 소유합니다. 매월 유효 실행일을 계산하고, 같은 정기지출·월 조합을 한 번만 거래 원장에 등록하며, 정기 생성 거래의 출처를 명확히 표시합니다.

이 모듈이 보장할 핵심 불변식은 다음과 같습니다.

- 활성이고 금액이 양수인 정기지출만 자동 생성 후보입니다.
- 29~31일은 해당 월의 마지막 날로 보정합니다.
- 같은 정기지출과 대상 월은 재실행해도 거래 한 건만 생성합니다.
- 거래 생성 성공과 처리 월 갱신은 하나의 원자적 명령입니다.
- 정기지출 정의는 거래 원장을 직접 쓰지 않고 원장 모듈의 공개 계약을 사용합니다.
- 사용자 접속과 무관한 서버 Scheduler가 `Asia/Seoul` 기준 매일 00:00에 처리하며, 일시 장애로 미처리된 기존 계획의 월은 다음 실행에서 오래된 순서로 자동 복구합니다.
- Plan 최초 등록자의 `memberId`를 immutable `creatorMemberId`로 보존하고 모든 Scheduler 생성 거래에 사용합니다.

## 2. 포함·제외 범위

### 포함

- 정기지출 정의의 생성·조회·수정·삭제
- 가맹점·금액·카테고리·매월 일자·메모·활성 상태 관리
- 월별 유효 실행일 계산
- 당월 생성 대상 판정
- 매일 실행되는 서버 Scheduler용 due-plan·누락 월 page 처리
- `firstApplicableMonth` 이후 미처리 월의 자동 소급 복구
- 결정적 거래 생성 명령과 마지막 처리 월 갱신
- 정기 생성 거래의 `source=recurring` 계약
- Plan 최초 등록자 creator 보존과 creator 없는 레거시 Plan의 명시적 migration mapping

### 제외

- 생성된 거래의 이후 수정·삭제
- 일반 거래와 명시적 가구원 알림 전송
- 카테고리 자체 관리
- 자산 자동 납입·대출 상환
- 서버 Scheduler 인프라와 화면 진입 시점 결정

## 3. 소유 데이터

| 데이터 | 소유 범위 | 비고 |
|---|---|---|
| `recurring_expenses` | 가맹점, 금액, 카테고리 참조, 일자, 메모, 활성 상태, immutable creatorMemberId | 정기지출 정의 Aggregate입니다. |
| 처리 상태 | `lastRegisteredMonth` | 대상 월 중복 처리를 막는 checkpoint입니다. |
| 정기 거래 명령 ID | `recurring_{정의 ID}_{YYYY-MM}` | [거래 원장 모듈](../ledger/requirements.md)에 전달하는 멱등 키입니다. |
| 레거시 creator migration receipt | planId, creatorMemberId, actor, migratedAt, 이전 Plan version | creator가 없던 Plan의 명시적 귀속 근거이며 일반 Plan 수정으로 변경하지 않습니다. |

생성된 `expenses` 문서는 거래 원장 모듈이 소유합니다. 이 모듈은 원장 거래 ID와 처리 월만 연결합니다.

## 4. 공개 계약·의존 모듈

### 외부에 제공하는 계약

| 계약 | 입력 | 결과 |
|---|---|---|
| `ManageRecurringPlan` | create·update·delete operation과 expected version | 생성·갱신된 Plan 또는 삭제 결과 |
| `ListRecurringPlans` | 가구 ID, active filter, cursor·limit | 일자·가맹점·Plan ID 순 page |
| `CalculateEffectiveDay` | 연월, 지정일 | 월 말일을 반영한 실행일 |
| `ProcessRecurringMonth` | 가구 ID, 대상 월, Clock | 생성된 거래 또는 이미 처리됨 |
| `ProcessDueRecurringPlans` | 기준 LocalDate·ZoneId, page cursor·limit | 처리 월별 결과, 다음 checkpoint, 완료 여부 |
| `MapLegacyRecurringCreator` | creator가 없는 legacy plan ID, 같은 가구의 creatorMemberId, expected version | 매핑된 Plan 또는 이미 매핑됨·검증/충돌 오류 |
| `RemapRecurringCategoryReferences` | 보관 대상 카테고리 ID, 현재 기본 카테고리 ID, process ID, cursor·limit | 변경 건수, 다음 cursor, 완료 여부 |

### 의존 모듈·포트

- [가구·접근 모듈](../../../access-household/modules/household-access/requirements.md): 가구와 생성자 멤버 ID를 제공합니다.
- [카테고리·예산 모듈](../categories-budget/requirements.md): 참조 카테고리 유효성을 확인합니다.
- [거래 원장 모듈](../ledger/requirements.md): 멱등 plan/month key를 받는 `RecordRecurringTransactionParticipant` 계약을 제공합니다.
- [알림 모듈](../../../notifications/modules/notifications/requirements.md): `source=recurring` 거래를 일반 새 지출 푸시에서 제외합니다.
- Clock·Transaction Manager: 월 경계와 정의 checkpoint·거래 생성의 원자성을 제어합니다.

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| REC-001 | 현재 명세 | 정기지출은 가맹점, 금액, 카테고리, 매월 일자 1~31, 선택 메모, 활성 상태를 관리한다. | 현재 일자는 검증하지만 금액 0·음수를 엄격히 차단하지 않는다. 자동 생성 대상은 양수 금액으로 제한하는 목표 테스트가 필요하다. | [RecurringExpenseSettings](../../../../../../web/src/components/settings/RecurringExpenseSettings.tsx), [recurringExpenseService](../../../../../../web/src/lib/recurringExpenseService.ts) | U, I, E2E |
| REC-002 | 목표 명세 | 서버 Scheduler는 사용자 접속 여부와 무관하게 `Asia/Seoul` 기준 매일 00:00에 활성 정기지출을 처리하고 실행일이 도래한 각 plan·월 거래를 한 번만 등록한다. | 짧은 달은 말일로 보정한다. 같은 날짜 Scheduler 중복 호출과 재시도는 결정적 `planId:YYYY-MM` execution으로 한 건에 수렴한다. | [recurringExpenseService](../../../../../../web/src/lib/recurringExpenseService.ts), [DEC-009](../../../../governance/decisions.md#dec-009) | U, I, E2E |
| REC-003 | 목표 명세 | Scheduler는 `firstApplicableMonth`부터 기준일 현재 실행일이 도래한 월까지 미처리 execution을 오래된 월부터 자동 생성한다. | 지정일 이전·당일 생성은 당월, 지정일 이후 생성은 다음 달부터 시작하며 계획 생성 전 월은 소급하지 않는다. page 한도를 넘는 누락은 checkpoint로 이어서 처리한다. | [recurringExpenseService](../../../../../../web/src/lib/recurringExpenseService.ts), [DEC-009](../../../../governance/decisions.md#dec-009) | U, I, E2E |
| REC-004 | 현재 명세 | 정기지출로 생성된 거래는 거래 생성 자동 푸시에서 제외한다. | 사용자가 직접 실행한 `알림 보내기`는 별도 요청이며 requester를 제외한 가구원에게 전달한다. | [Notification Outbox consumer](../../../../../../functions/src/bootstrap/firebaseNotificationOutbox.ts), [DEC-013](../../../../governance/decisions.md#dec-013) | I |
| REC-005 | 목표 명세 | 카테고리 보관 Process가 요청하면 해당 카테고리를 참조하는 모든 정기지출 정의를 현재 기본 카테고리로 변경한다. | 활성·비활성 정의를 모두 변경하며 이미 생성된 과거 원장 거래는 변경하지 않는다. page 단위 명령은 process ID와 cursor로 멱등 처리한다. | [DEC-015](../../../../governance/decisions.md#dec-015) | U, I |
| REC-006 | 목표 명세 | Plan 생성 시 인증된 최초 등록자의 memberId를 immutable `creatorMemberId`로 저장하고 Scheduler가 생성하는 모든 월별 거래에 그대로 사용한다. | create·update payload에서 creator를 받지 않는다. creator 없는 레거시 Plan은 같은 가구의 실제 Member를 가리키는 명시적 migration mapping 전에는 자동 거래를 만들지 않으며 현재 멤버·SystemActor로 추정하지 않는다. 일반 수정과 migration 재시도는 이미 설정된 creator를 덮어쓰지 않고 기존 거래도 소급 변경하지 않는다. | [DEC-063](../../../../governance/decisions.md#dec-063) | U, I, Migration |

## 6. 모듈 결함

- 생성·수정 경계가 0 또는 음수 금액을 일관되게 거부하지 않습니다.
- 처리 중 일부 예외를 삼켜 데이터 없음·이미 처리됨·실패를 구분하기 어렵습니다.
- 거래 생성과 `lastRegisteredMonth` 갱신이 Repository 기술 세부사항에 결합되어 있습니다.
- 자동 처리 호출 시점이 화면 생명주기에 묶여 사용자가 앱을 열지 않은 달의 처리를 보장하지 못합니다. 서버 Scheduler와 누락 월 복구로 대체해야 합니다.
- 거래 원장과 알림 모듈이 `source` 문자열을 암묵적으로 해석하므로 명시적 계약 테스트가 필요합니다.
- 현재 레거시 Plan에는 최초 등록자 필드가 없을 수 있으므로 임의 추정 없이 명시적 creator mapping과 미해결 Plan 차단이 필요합니다.

## 7. 관련 DEC 링크

- [DEC-009: 정기지출 과거 누락 월 처리 정책](../../../../governance/decisions.md#dec-009) — 매일 서버 처리와 `firstApplicableMonth` 이후 모든 누락 월 자동 복구를 확정합니다.
- [DEC-013: 거래 생성자와 채널별 알림 정책](../../../../governance/decisions.md#dec-013) — 정기지출은 거래 생성 자동 푸시 제외라는 `REC-004`를 유지합니다.
- [DEC-015: 사용 중인 카테고리 삭제](../../../../governance/decisions.md#dec-015) — 카테고리 보관 시 정기지출 정의의 참조를 현재 기본 카테고리로 변경합니다.
- [DEC-063: 정기 거래 Plan creator](../../../../governance/decisions.md#dec-063) — 최초 등록자를 immutable creator로 저장하고 레거시는 명시적 mapping 뒤에만 처리합니다.

## 8. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-REC-001 | 특성화 | 같은 정기지출·월 명령의 동시 실행·재전달 / 처리 / 실제 원장 거래·execution·공개 Event가 각각 한 세트이고 최초 결과를 재생 | REC-002 |
| T-REC-002 | 현재 명세 | 매월 31일 일정과 2월 / 처리 / 2월 말일 회계일의 실제 원장 거래와 execution 한 건 생성 | REC-002 |
| T-REC-003 | 목표 | 전체 필드 create·update·delete·목록, 빈 가맹점·0/음수/소수 금액·일자 범위 밖·사용 불가 카테고리·creator 주입 / Plan 관리 / 유효 명령만 전체 필드와 인증 Actor creator를 보존하고 invalid는 Plan·receipt·Event를 만들지 않음 | REC-001, REC-006 |
| T-REC-004 | 목표 | 지정일 이전·당일·이후에 새 일정 생성 / firstApplicableMonth 계산 / 앞의 두 경우는 당월, 마지막은 다음 달이며 생성 전 월 제외 | REC-003 |
| T-REC-005 | 목표 | Asia/Seoul 00:00 일일 실행, 7·8월 처리 실패 상태에서 9월 실행일 자정 job, 비활성·비양수 legacy Plan, page limit, 부분 실패·재실행 / 처리 / 7·8·9월 실제 원장 거래를 오래된 순서로 각 한 건 생성하고 제외 대상은 건너뛰며 checkpoint에서 실패 월부터 재개 | REC-002, REC-003, DEC-009 |
| T-REC-PUSH-001 | 특성화 | recurring source 생성 / 알림 모듈에 이벤트 전달 / 새 거래 푸시 없음 | REC-004 |
| T-REC-006 | 목표 | 거래 저장 또는 checkpoint 갱신 실패 / 처리 / 둘 다 이전 상태이며 재실행 가능 | REC-002 |
| T-REC-007 | 목표 | A가 만든 Plan을 B가 수정하고 Scheduler가 처리하는 경우, creator 없는 레거시 Plan과 명시적 mapping, mapping 전 생성된 과거 거래 / creator 정책 / A 유지, 미매핑 거래 0건, 같은 가구 Member mapping 뒤에만 처리, 재실행으로 creator 불변이며 과거 거래는 소급 변경하지 않음 | REC-006, DEC-063 |

`REC-004`의 모듈 간 알림 계약은 [알림 모듈의 T-PUSH-002](../../../notifications/modules/notifications/requirements.md#9-모듈-테스트-시나리오)에서 한 번만 정의하고 함께 검증합니다. `REC-005`의 archive/remap 종단 시나리오는 [카테고리·예산 모듈의 T-CAT-004](../categories-budget/requirements.md#8-모듈-테스트-시나리오)를 단일 원본으로 공유합니다. 정기 거래 모듈은 같은 `T-CAT-004` ID의 participant conformance에서 활성·비활성 Plan, page 재개·재전달, 과거 원장 불변만 검증하며 별도의 중복 Canonical ID를 만들지 않습니다.

## 9. 코드 근거

### Web

- [정기지출 서비스](../../../../../../web/src/lib/recurringExpenseService.ts)
- [정기지출 설정](../../../../../../web/src/components/settings/RecurringExpenseSettings.tsx)

### Functions

- [알림 Outbox consumer](../../../../../../functions/src/bootstrap/firebaseNotificationOutbox.ts)
