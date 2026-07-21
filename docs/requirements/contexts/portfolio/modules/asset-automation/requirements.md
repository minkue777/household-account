# 자산 자동화 모듈 요구사항

> 상위 Bounded Context: [Portfolio](../../requirements.md)  
> 아키텍처 역할: Domain Policy / Application Workflow  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 표기 규칙은 [공통 요구사항 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `AUTO-*`, `LOAN-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

자산 자동화 모듈은 적금의 월 납입과 대출의 월 상환을 언제, 얼마만큼 반영할지 결정하는 업무 규칙을 소유합니다. 같은 자산·대상 월 명령은 한 번만 반영하며 월말 보정, 상환 방식별 원금 계산, 0원 하한을 UI나 Firebase 없이 순수 정책으로 제공합니다.

자동화 모듈은 자산 문서를 직접 저장하지 않습니다. 실행 대상을 조회하고 계산 결과와 처리 월을 포트폴리오 모듈의 멱등 명령으로 전달합니다.

## 2. 포함/제외 범위

### 포함

- 적금 월 납입 대상 여부와 유효 납입일 계산
- 원금균등·원리금균등의 월 원금 감소 계산
- 만기일시상환의 자동 처리 제외
- 자산별 마지막 처리 월을 이용한 월 단위 멱등성
- 신규·기존 자산의 자동화 최초 활성화 월 반영 기준
- 화면 방문과 분리된 매일 00:00 due-plan Application job과 누락 월 복구
- Plan 변경·비활성·삭제 뒤 과거 execution과 effective revision 보존

### 제외

- 자산 CRUD와 최종 잔액 저장: [자산 포트폴리오 모듈](../portfolio/requirements.md)
- 보유종목 평가와 시세 갱신: [보유종목·시장 데이터 모듈](../holdings-market-data/requirements.md)
- 스케줄러 런타임, 재시도와 운영 관측: [외부 운영 모듈](../../../../supporting-platform/modules/external-operations/requirements.md)
- 정기지출 거래 생성
- 실제 은행 자동이체 실행

## 3. 소유 데이터

| 데이터 | 소유권과 불변식 |
|---|---|
| 적금 자동화 설정 | `recurringContributionAmount`, `recurringContributionDay`, `lastAutoContributionMonth`의 legacy 의미와 목표 Plan의 revision·`nextDueDate` 검증 규칙을 소유합니다. |
| 대출 자동화 설정 | `loanInterestRate`, `loanRepaymentMethod`, `loanMonthlyPaymentAmount`, `loanPaymentDay`, `lastAutoRepaymentMonth`의 legacy 의미와 목표 Plan의 revision·`nextDueDate` 검증 규칙을 소유합니다. |
| 월 처리 명령 | `(assetId, targetMonth, operationType)`을 멱등 키로 사용합니다. |

필드는 현재 `assets` 문서에 함께 저장되지만 물리 저장의 최종 Writer는 포트폴리오 모듈입니다. 자동화 모듈은 위 필드의 업무 의미만 소유하고 공개 포트를 통해 읽고 갱신합니다.

## 4. 공개 계약·의존 모듈

### 공개 계약

- `EvaluateSavingsContribution(asset, asOf)`
- `CalculateEffectivePaymentDate(yearMonth, configuredDay)`
- `CalculateLoanPrincipalPayment(balance, annualRate, repaymentMethod, monthlyPayment)`
- `EvaluateLoanRepayment(asset, asOf)`
- `ProcessDueAssetAutomation(asOfDate, runId, cursor)`
- 처리 결과: 적용, 아직 미도래, 이미 적용, 지원하지 않는 방식, 잘못된 설정

### 의존 모듈

- 자산 포트폴리오 모듈: 자동화 대상 조회와 잔액·처리 월의 원자적 반영
- 가구 모듈: 처리 범위
- 외부 운영 모듈: 화면과 분리된 실행 트리거, 재시도와 실패 관측
- 주입된 `Clock`: 현재 날짜와 `Asia/Seoul` 월 경계 계산

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| AUTO-001 | 현재 명세 | 활성 적금이 유효한 월 납입액·납입일을 가지고 당월 미적용이며 납입일이 지났으면 잔액에 한 번 더한다. | 29~31일은 말일로 보정한다. | [assetService](../../../../../../web/src/lib/assetService.ts) | U, I |
| AUTO-002 | 현재 명세 | 자산과 Plan을 함께 만들거나 기존 자산에서 자동화를 처음 활성화한 날이 당월 납입일·상환일 이후이면 현재 잔액에 당월분이 포함됐다고 보고 금액을 추가 변경하지 않은 채 당월을 처리 완료로 표시한다. | 다음 달부터 자동 처리한다. 최초 활성화일이 실행일 이전 또는 당일이면 당월을 최초 적용 월로 사용하고, 자동화 활성화 전 월은 소급하지 않는다. 이후 설정 변경·재개는 최초 활성화로 다시 계산하지 않고 기존 revision·execution을 잇는다. | [AssetAddModal](../../../../../../web/src/components/assets/AssetAddModal.tsx), [DEC-011](../../../../governance/decisions.md#dec-011) | U |
| LOAN-001 | 현재 명세 | 원금균등은 월 납입액 전부를, 원리금균등은 월 납입액에서 월 이자를 뺀 값을 원금 감소로 계산한다. | 원금 감소는 잔액을 넘지 않고 0 아래로 내려가지 않는다. | [assetMath](../../../../../../web/src/lib/assets/assetMath.ts) | U |
| LOAN-002 | 현재 명세 | 활성 대출이 지원 상환 방식이고 금리·납입액·납입일이 유효하며 당월 미적용이면 한 번 원금을 차감한다. | 만기일시상환은 자동 처리하지 않는다. | [assetService](../../../../../../web/src/lib/assetService.ts) | U, I |
| AUTO-003 | 결함 | 서버는 사용자 접속과 무관하게 매일 00:00 `Asia/Seoul`에 active이거나 중지 전 overdue를 복구 중이면서 `nextDueDate<=asOfDate`인 Plan만 page 조회하고, 실행일이 도래한 누락 월을 오래된 순서로 처리한다. | 성공한 월만 다음 due date로 전진하며 retryable 실패는 due로 남겨 다음 실행에서 재시도한다. `(householdId, assetId, operation, targetMonth)` execution으로 중복을 막고 소급 기간의 제품 상한은 두지 않는다. 잘못된 Plan은 `needsAttention`으로 격리한다. Asset 운영 복구 시 삭제 전 overdue만 유지하고 삭제 기간은 제외하며, 복구일이 당월 실행일 이전·당일이면 당월, 이후이면 다음 달부터 재개한다. [DEC-052](../../../../governance/decisions.md#dec-052) | [assets page](../../../../../../web/src/app/assets/page.tsx) | U, I, E2E |

## 6. 모듈 결함

- 자동 처리가 자산 화면 방문이라는 UI 생명주기에 묶여 있어 사용자가 방문하지 않으면 실행되지 않습니다. (`AUTO-003`)
- 자동 처리 도중 오류가 발생했을 때 재시도와 부분 성공을 추적할 독립 실행 계약이 없습니다. (`AUTO-003`)

## 7. 관련 DEC

- [DEC-011](../../../../governance/decisions.md#dec-011): 신규·기존 자산 모두 자동화 최초 활성화일이 실행일 이후이면 현재 잔액에 당월분이 포함된 것으로 보고 다음 달부터 자동 처리합니다.
- [DEC-017](../../../../governance/decisions.md#dec-017): deleted Asset의 Plan·execution은 보존하되 자동 처리 대상에서 제외합니다. 일반 사용자는 복구할 수 없고 운영 복구 Workflow만 resume revision을 추가합니다.
- [DEC-046](../../../../governance/decisions.md#dec-046): AutomationExecution은 업무 이력이므로 시간 TTL을 두지 않고 관련 Asset 또는 가구의 수동 영구 purge에서만 제거합니다.
- [DEC-052](../../../../governance/decisions.md#dec-052): 매일 00:00 due Plan만 조회해 누락 월을 멱등 복구하고, Plan revision과 과거 execution을 보존하며 자동 재계산하지 않습니다.

## 8. 모듈 테스트 시나리오

### Canonical 테스트

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-AUTO-001 | 특성화 | 31일 납입, 2월 말 / 재실행 / 말일에 한 번만 반영 | AUTO-001 |
| T-AUTO-002 | 목표 | 신규 자산과 과거에 만든 기존 자산의 자동화 최초 활성화일이 실행일 이전·당일·이후 / 최초 월 판정 / 이전·당일은 당월 적용, 이후는 delta 0 당월 완료·다음 달 적용, 활성화 전 월 소급 없음 | AUTO-002, DEC-011 |
| T-AUTO-003 | 목표 | 납입일 18일 Plan을 3월 20일 삭제하고 관리자·운영 주체가 5월 17·18·19일에 각각 복구 / resume revision과 due 월 조회 / 일반 사용자 복구는 거부하고 삭제 전 overdue는 유지하되 삭제 기간은 제외하며, 17·18일 복구는 5월부터 19일 복구는 6월부터 재개 | AUTO-003, AST-006, DEC-017, DEC-052 |
| T-LOAN-001 | 특성화 | 잔액보다 큰 원금 감소 / 처리 / 잔액 0이며 음수 아님 | LOAN-001 |
| T-LOAN-002 | 목표 | 원금균등·원리금균등·만기일시상환, 잘못된 금리·납입액·납입일, 이미 처리한 월과 동시 실행 / 대출 자동 상환 / 지원 방식만 due 원금을 한 execution으로 반영하고 unsupported·validation·중복 요청은 write 0건이며 같은 월 claim 하나로 수렴 | LOAN-002 |

### 상세 시나리오

| 시나리오 | 수준 | 연결 요구사항 |
|---|---|---|
| 31일 납입 적금을 2월 말일에 여러 번 처리해도 한 번만 잔액에 더한다. | U, I | AUTO-001 |
| 납입일 전, deleted 자산, 0 이하 납입액, 이미 처리한 월은 적용하지 않는다. | U | AUTO-001, AST-006 |
| 당월 실행일 이후 신규 자산 생성 또는 기존 자산의 자동화 최초 활성화 / 최초 월 판정 / 금액 추가 변경 없이 당월 처리 완료, 다음 달부터 자동 적용 | U | AUTO-002 |
| 당월 실행일 이전·당일 자동화 최초 활성화 / 최초 월 판정 / 당월이 최초 적용 월이며 실행일 도래 시 한 번 반영 | U | AUTO-002 |
| 원금균등은 월 납입액 전부를 원금으로 차감하되 잔액보다 많이 차감하지 않는다. | U | LOAN-001 |
| 원리금균등은 월 이자를 뺀 금액만 원금에서 차감하고 결과를 0 아래로 내리지 않는다. | U | LOAN-001 |
| 만기일시상환, 잘못된 금리·납입액·납입일, 납입일 전, 이미 처리한 월은 자동 상환하지 않는다. | U | LOAN-002 |
| 3월 18일이 nextDueDate인 Plan / 3월 18일 00:00 실행 / 해당 월 한 번 반영하고 nextDueDate를 4월 유효일로 전진 | U, I, E2E | AUTO-003 |
| 3월 18·19일 실행이 retryable 실패 / 3월 20일 00:00 실행 / 3월 execution을 한 번만 반영하고 성공 전에는 nextDueDate를 전진시키지 않음 | I, E2E | AUTO-003 |
| 아직 due가 아닌 활성 Plan과 중지 전 overdue가 없는 inactive·deleted Plan / 일일 실행 / Repository 대상 page에 포함하지 않고 write 없음 | I | AUTO-003 |
| 여러 달 누락된 Plan / 일일 실행과 checkpoint 재개 / firstApplicableMonth 이후 due 월을 오래된 순서로 모두 수렴하고 기간 상한으로 버리지 않음 | U, I, E2E | AUTO-003 |
| Plan 금액·날짜 변경 또는 비활성·삭제 / 과거 execution 조회와 누락 월 처리 / commit된 execution은 불변이며 누락 월은 당시 effective revision 사용, 변경 이후 due만 새 설정·중지 적용 | U, I | AUTO-003 |
| 3월 18일 미처리 후 3월 20일 삭제, 5월 17일 운영 복구 / 6월 20일 due 조회 / 3월·5월·6월은 오래된 순서로 처리하고 삭제 기간인 4월은 생성하지 않음 | U, I, E2E | AUTO-003, AST-006 |
| 일반 사용자 Actor / 삭제 자산 복구 요청 / Automation resume revision과 Asset 상태 모두 write 0건 | 보안 E2E | AUTO-003, AST-006 |

## 9. 코드 근거

- [자산 자동 처리 서비스](../../../../../../web/src/lib/assetService.ts)
- [대출 계산 정책](../../../../../../web/src/lib/assets/assetMath.ts)
- [자산 생성 화면의 초기 처리 월 설정](../../../../../../web/src/components/assets/AssetAddModal.tsx)
- [자산 화면의 자동 처리 호출](../../../../../../web/src/app/assets/page.tsx)
- [자산 타입과 자동화 필드](../../../../../../web/src/types/asset.ts)
