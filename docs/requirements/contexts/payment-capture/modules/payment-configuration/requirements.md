# 결제 설정 모듈 요구사항

> 상위 Bounded Context: [Payment Capture](../../requirements.md)  
> 아키텍처 역할: Reference Data Domain / Application  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 수준의 의미는 [공통 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `CARD-*`, `MER-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

결제 설정 모듈은 자동 결제 입력을 사용자의 카드와 분류 정책에 연결하는 기준 데이터를 소유합니다. 등록 카드의 소유자·카드사·마지막 번호·표시 순서와 가맹점 매칭·치환 규칙을 Web과 Android에 동일한 계약으로 제공합니다.

이 모듈이 보장할 핵심 불변식은 다음과 같습니다.

- 등록 카드 번호는 비교 전에 숫자 마지막 네 자리로 정규화합니다.
- 같은 가구·소유자 안의 동일 카드사·동일 번호 조합은 하나만 존재합니다.
- 가맹점 규칙 keyword는 정규화된 원 가맹점에만 적용하며 memo는 매칭 입력이 아니라 선택된 규칙의 치환·보존 출력입니다. exact 등 좁은 match type을 먼저 적용하고, 겹칠 수 있는 non-exact 규칙은 같은 유형 안의 고유 우선순위로 결정하며 저장소 반환 순서를 사용하지 않습니다.
- Web과 Android는 동일한 입력 fixture에 같은 카드 식별·가맹점 mapping 결과를 반환합니다.
- 이 모듈은 거래를 생성하지 않고, 매칭 결과만 자동 입력 모듈에 제공합니다.

## 2. 포함·제외 범위

### 포함

- 가구·소유자별 등록 카드 생성·조회·수정·삭제·재정렬
- 카드 번호 정규화와 번호 없는 간편결제 예외
- 마스킹 카드 번호 비교
- 가맹점 규칙 생성·조회·수정·삭제
- non-exact 가맹점 규칙 우선순위 재정렬
- exact·contains·startsWith·endsWith와 쉼표 OR 매칭
- 규칙 우선순위와 가맹점·카테고리·메모 mapping
- 구형 `exactMatch`·`category` 문서 호환 읽기

### 제외

- 금융 알림 출처 판별과 카드 메시지 파싱
- 카드 승인·취소 거래 저장
- 카테고리 정의와 삭제 정책
- 멤버 생명주기와 이름 변경
- 카드 번호 전체 저장, 결제 수단 인증, 금융사 연동

## 3. 소유 데이터

| 데이터 | 소유 범위 | 비고 |
|---|---|---|
| `registered_cards` | 가구, 소유 멤버 참조, 카드사, 마지막 번호, 사용자 순서 | 안정적인 멤버 ID를 소유자 참조로 사용해야 합니다. |
| 카드사 정의 | 지원 카드사 라벨, 번호 없는 간편결제 라벨, 기본 정렬 기준 | Web·Android 공통 계약입니다. |
| `merchant_rules` | 키워드, 매칭 유형, 우선순위, 활성 상태, mapping | 가구 범위 Aggregate입니다. |
| 레거시 규칙 해석 | `exactMatch`, `category`를 현재 모델로 변환 | 마이그레이션 종료 전까지 유지하는 Adapter 책임입니다. |

거래의 카드 표시 정보와 최종 카테고리·가맹점·메모는 [거래 원장 모듈](../../../household-finance/modules/ledger/requirements.md)이 소유합니다.

## 4. 공개 계약·의존 모듈

### 외부에 제공하는 계약

| 계약 | 입력 | 결과 |
|---|---|---|
| `RegisterCard` | ActorContext, 소유 멤버 ID, 카드사·결제수단 code, 선택 마지막 번호 | 표준 라벨로 표시할 정규화된 등록 카드 또는 권한·중복 오류 |
| `UpdateRegisteredCard` | 카드 ID, 끝 번호, 예상 version | 갱신된 카드 또는 충돌·중복 오류 |
| `DeleteRegisteredCard` | 카드 ID, 예상 version | 퇴역 처리된 카드 또는 충돌 오류 |
| `ListMemberCards` | 가구 ID, 멤버 ID | 사용자 순서를 적용한 카드 목록 |
| `ReorderCards` | ActorContext, 멤버 ID, 활성 카드 ID 전체 목록, 예상 collection version | 원자적으로 저장된 순서 또는 집합·version 충돌 |
| `MatchRegisteredCard` | 가구 ID, 멤버 ID, 파싱 카드사·마스킹 번호 | 일치 카드 또는 불일치 |
| `CreateMerchantRule` | ActorContext, 키워드, 매칭 유형, non-exact 우선순위, mapping | 규칙 또는 권한·exact 키워드·우선순위 중복 오류 |
| `ReorderMerchantRules` | ActorContext, non-exact 매칭 유형, 활성·비활성 전체 규칙 ID 순서와 collection version | 원자적으로 저장된 고유 우선순위 |
| `MatchMerchantRule` | 가구 ID, 정규화할 원 가맹점 | 좁은 match type과 유형별 고유 우선순위로 선택한 규칙 및 merchant·category·memo 치환 결과 또는 불일치 |
| `RemapMerchantRuleCategoryReferences` | 보관 대상 카테고리 ID, 현재 기본 카테고리 ID, process ID, cursor·limit | 변경 건수, 다음 cursor, 완료 여부 |

### 의존 모듈·포트

- [가구·접근 모듈](../../../access-household/modules/household-access/requirements.md): 가구와 안정적인 소유 멤버 ID를 제공합니다.
- [카테고리·예산 모듈](../../../household-finance/modules/categories-budget/requirements.md): mapping의 카테고리 참조를 검증합니다.
- [Android 결제 수집 모듈](../android-payment-ingestion/requirements.md): 카드 식별과 가맹점 mapping 계약을 소비합니다.
- [Shortcut 입력 모듈](../shortcut-ingestion/requirements.md): 인증된 현재 멤버에게 카드사·번호가 일치하는 등록 카드가 있는지 확인할 때 카드 계약을 소비합니다.
- [거래 원장 모듈](../../../household-finance/modules/ledger/requirements.md): 사용자가 거래 카테고리를 기억하도록 선택할 때 규칙 생성 명령을 호출합니다.

## 5. 요구사항

### 등록 카드

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| CARD-001 | 현재 명세 | 카드를 가구·소유자별로 관리하며 카드사, 마지막 번호, 사용자 순서를 저장한다. | 번호는 숫자만 남긴 마지막 네 자리로 정규화한다. | [registeredCardService](../../../../../../web/src/lib/registeredCardService.ts) | U, I, E2E |
| CARD-002 | 현재 명세 | 같은 소유자의 동일 카드사·동일 번호 조합은 중복 등록할 수 없다. | 번호 없는 등록 카드는 해당 소유자·카드사의 모든 번호를 허용하는 wildcard다. 같은 소유자의 같은 카드사에는 번호 없는 wildcard 카드를 하나만 둘 수 있다. | [registeredCardService](../../../../../../web/src/lib/registeredCardService.ts), [CardSettings](../../../../../../web/src/components/settings/CardSettings.tsx), [DEC-028](../../../../governance/decisions.md#dec-028) | U, I |
| CARD-003 | 현재·목표 | 명시 순서를 우선하고, 없으면 번호 없는 간편결제 라벨을 일반 카드 뒤로 보낸 다음 카드사·번호·ID 순으로 정렬한다. `ReorderCards`는 해당 멤버의 활성 카드 ID 전체와 예상 collection version을 받아 고유 순서를 원자 저장한다. | 번호가 비어 있다는 사실 자체가 아니라 네이버페이·카카오페이·토스 라벨을 기준으로 한다. 누락·중복·타 멤버 ID, stale version, commit 실패는 모든 카드 순서와 version을 원상 유지한다. 구형 순서 없는 문서는 조회에서만 순서를 보정한다. | [registeredCardService](../../../../../../web/src/lib/registeredCardService.ts) | U, I |
| CARD-004 | 목표 명세 | Android·Shortcut 자동 등록은 인증된 현재 멤버가 소유한 등록 카드와 카드사·번호가 일치해야 한다. | 다른 가구원의 카드는 조회 후보에서 제외한다. 본인 카드가 하나 이상 일치하면 허용하고 여러 건 일치해도 거래를 거부하지 않으며, 특정 카드를 확정할 수 없으면 임의 선택하지 않는다. 도시가스 청구는 예외이다. | [본인 카드 판정 정책](../../../../../../functions/src/contexts/payment-capture/configuration/domain/policies/ownCardResolution.ts), [DEC-028](../../../../governance/decisions.md#dec-028) | U, I |
| CARD-005 | 목표 명세 | 등록 카드의 카드사·소유자는 생성 후 바꿀 수 없는 identity이고, 잘못 등록했거나 소유자가 달라지면 기존 카드를 논리 삭제한 뒤 새 카드로 등록한다. 기존 카드에서는 끝 번호만 수정하고 정렬은 별도 재정렬 명령으로 변경한다. 사용자 자유 입력 카드 이름·별칭은 제공하지 않으며 화면 이름은 카드사·결제수단 code의 표준 라벨이다. | 모든 Command는 인증 Actor의 가구·본인 소유 범위를 검증한다. 카드사·`ownerMemberId` 변경 입력은 write 0건으로 거부한다. 끝 번호 수정은 새 uniqueness claim 생성·카드 version 갱신·이전 claim 해제를 한 transaction에서 수행한다. 논리 삭제된 카드는 과거 capture 증거를 위해 `retired`로 보존하되 활성 목록·정렬·매칭에서 제외하고 활성 claim을 해제한다. 과거 거래에 저장된 카드사·끝 번호 검색 증거는 수정하지 않으며 일반 사용자 복구 Command는 제공하지 않는다. | [registeredCardService](../../../../../../web/src/lib/registeredCardService.ts), [CardSettings](../../../../../../web/src/components/settings/CardSettings.tsx), [DEC-059](../../../../governance/decisions.md#dec-059) | U, I, UI |

### 가맹점 규칙

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| MER-001 | 현재·목표 | exact, contains, startsWith, endsWith 매칭과 쉼표로 나눈 OR 키워드를 지원하고 모든 keyword는 정규화된 원 가맹점에만 적용한다. | 대소문자와 앞뒤 공백을 무시한다. 빈 전체 keyword와 빈 OR token은 거부한다. memo는 매칭 후보를 만들지 않으며 MER-003의 mapping 출력으로만 치환하거나 보존한다. | [merchantRuleService](../../../../../../web/src/lib/merchantRuleService.ts), [가맹점 규칙 선택 정책](../../../../../../functions/src/contexts/payment-capture/configuration/domain/policies/merchantRuleSelection.ts) | U, C |
| MER-002 | 목표 명세 | 여러 활성 규칙이 맞으면 숫자 priority보다 `exact → startsWith → endsWith → contains`의 좁은 match type을 먼저 선택하고, 선택된 non-exact 유형 안에서 가장 높은 고유 priority 규칙 하나를 적용한다. | exact는 priority를 사용하지 않고 키워드 유일성으로 최대 한 후보만 허용한다. 더 좁은 유형에 후보가 있으면 넓은 유형은 무시한다. canonical 동률은 저장할 수 없으며 레거시 충돌은 임의 승자 없이 `ContractFailure`다. 현재 우선순위 선적용과 Android 동률 first 선택은 목표 동작이 아니다. | [가맹점 규칙 선택 정책](../../../../../../functions/src/contexts/payment-capture/configuration/domain/policies/merchantRuleSelection.ts), [merchantRuleService](../../../../../../web/src/lib/merchantRuleService.ts), [DEC-042](../../../../governance/decisions.md#dec-042) | U, C |
| MER-003 | 현재 명세 | 선택 규칙은 가맹점명, 카테고리, 메모를 각각 치환할 수 있다. | Android에서 빈 memo 매핑은 파서 메모를 유지한다. | 같은 근거 | U, C |
| MER-004 | 결함 | 같은 가구의 exact 규칙은 정규화된 개별 OR 키워드마다 하나만 허용하고, non-exact 규칙은 같은 match type 안에서 비활성 규칙까지 포함해 priority가 서로 달라야 한다. | 모든 변경 Command는 Actor 가구를 검증한다. exact rule 두 개의 전체 표현이 달라도 한 exact 키워드가 겹치면 거부한다. contains·startsWith·endsWith 키워드는 겹칠 수 있다. 생성·수정·삭제는 keyword/priority claim과 본문을 원자 변경하고, 재정렬은 한 유형의 활성·비활성 전체 규칙 집합과 collection version을 검증해 목록 앞을 높은 priority로 한 번에 재번호한다. 누락·중복·타 가구·다른 유형 ID와 중간 실패는 write 0건이다. | [merchantRuleService](../../../../../../web/src/lib/merchantRuleService.ts), [DEC-042](../../../../governance/decisions.md#dec-042) | U, I, 동시성, UI |
| MER-005 | 현재·목표 | 기존 지출의 category를 예상 transaction version으로 수정하며 다음에도 기억을 선택하면 그 지출의 정규화된 원 가맹점 exact 규칙을 만든다. | 수입에는 제공하지 않는다. 지출 수정과 exact rule·claim 생성 또는 기존 rule 재사용은 한 UoW로 확정하며 권한·stale version·중간 실패에는 전부 원상 유지한다. 입력만으로 존재하지 않던 거래를 새로 만들지 않는다. | [ExpenseEditModal](../../../../../../web/src/components/expense/ExpenseEditModal.tsx) | I, E2E |
| MER-006 | 호환 | 기존 exactMatch/category 문서를 현재 matchType/mapping 모델로 읽는다. | `active=false`를 보존한다. 빈 keyword, 잘못된 category reference·priority와 regex 유형은 임의 보정 없이 typed `ContractFailure`다. 데이터 마이그레이션 완료 후 제거 일정을 정한다. | Web·Android 규칙 Repository | U, C |
| MER-007 | 목표 명세 | 카테고리 보관 Process가 요청하면 해당 카테고리를 mapping하는 모든 가맹점 규칙을 현재 기본 카테고리로 변경한다. | 활성·비활성 규칙을 모두 변경한다. page 단위 명령은 process ID와 cursor로 멱등 처리하며 규칙의 다른 mapping 필드는 유지한다. | [DEC-015](../../../../governance/decisions.md#dec-015) | U, I |

## 6. 모듈 결함

- 카드와 가맹점 규칙의 중복 확인이 check-then-write라 동시 요청에서 중복 문서를 만들 수 있습니다.
- 멤버 이름 변경 시 `registered_cards.owner`가 이동하지 않아 Web 카드 목록과 Android 자동 매칭이 이전 이름에 남습니다.
- 카드 소유권이 안정적인 멤버 ID가 아니라 표시 이름에 결합되어 있습니다.
- Web과 Android에 카드사 목록·정규화·가맹점 매칭 로직이 중복되어 회귀 가능성이 있습니다.
- Android와 Web의 Repository 오류가 빈 목록·불일치로 축약되면 실제 장애와 설정 없음이 구분되지 않습니다.
- 구형 규칙의 `exactMatch`·`category` 호환 종료 조건과 데이터 마이그레이션 시점이 아직 정의되지 않았습니다.
- 서비스 경계가 카테고리 참조의 유효성을 일관되게 검증하지 않습니다.
- 현재 priority 우선 정렬은 낮은 priority의 exact보다 높은 priority의 contains를 먼저 적용할 수 있고, Android의 동률 first 선택은 저장소 반환 순서에 따라 결과가 달라집니다.
- exact OR 키워드별 claim과 non-exact match type별 priority claim이 없어 동시 생성·수정·재정렬 중 충돌 규칙을 저장할 수 있습니다.

## 7. 관련 DEC 링크

`MER-007`은 DEC-015를 직접 구현합니다. 다음 결정도 이 모듈 계약의 소비 방식을 제한합니다.

- [DEC-005: 허용 결제 알림 출처 정책](../../../../governance/decisions.md#dec-005)
- [DEC-007: 도시가스 거래일 정책](../../../../governance/decisions.md#dec-007)
- [DEC-013: 거래 생성자와 채널별 알림 정책](../../../../governance/decisions.md#dec-013)
- [DEC-015: 사용 중인 카테고리 삭제](../../../../governance/decisions.md#dec-015) — archive 대상 카테고리를 참조하는 가맹점 규칙을 현재 기본 카테고리로 변경합니다.
- [DEC-028: 자동 결제 입력은 호출자 본인 소유 등록 카드만 허용](../../../../governance/decisions.md#dec-028) — owner 범위를 먼저 제한하고 한 건 이상 일치하면 자동 등록을 허용합니다.
- [DEC-042: 가맹점 규칙의 match type·우선순위](../../../../governance/decisions.md#dec-042) — 좁은 match type을 먼저 적용하고 exact 키워드와 non-exact 유형별 priority의 중복을 금지합니다.
- [DEC-059: 등록 카드 identity와 수정·퇴역 범위](../../../../governance/decisions.md#dec-059) — 카드사·소유자는 immutable identity이고 사용자 별칭 없이 끝 번호만 수정하며, 삭제는 과거 증거를 보존하는 퇴역 처리입니다.

## 8. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-MER-001 | 목표 | 낮은 priority exact와 높은 priority contains·startsWith·endsWith가 모두 일치 / 매칭 / priority와 무관하게 exact 적용, exact가 없으면 startsWith→endsWith→contains 순으로 선택 | MER-001~003, DEC-042 |
| T-MER-002 | 호환 | legacy exactMatch/category fixture / 매칭 / 현재 mapping과 같은 결과 | MER-006 |
| T-CARD-001 | 목표 | 호출자와 배우자에게 각각 번호 없는 같은 카드사 카드, 본인 exact·wildcard 0·1·여러 건 / Android·Shortcut 자동 등록 / 타 멤버 카드는 결과에 무관하고 본인 1건 이상 일치 시 등록, 0건이면 저장·알림 없음, 여러 건이면 임의 카드 선택 없음 | CARD-004, ING-SAVE-003~004, IOS-007, DEC-028 |
| T-CARD-002 | 현재 명세 | 숫자·공백·하이픈이 섞인 긴 카드 번호 / 등록 / 숫자 마지막 네 자리만 저장 | CARD-001 |
| T-CARD-003 | 목표 | 같은 카드 등록 명령 두 개 동시 실행 / 저장 / 한 문서만 생성되고 하나는 중복 결과 | CARD-002 |
| T-CARD-004 | 현재·목표 | 명시 순서와 순서 없는 일반 카드·간편결제, 완전·누락·중복·타 멤버 ID, stale version·중간 실패 / 조회·ReorderCards / 명시 순서 우선 후 계약 순서이며 유효한 전체 집합만 고유 order로 commit, 실패는 전체 순서·version rollback | CARD-003 |
| T-CARD-005 | 목표 | Actor·타 가구/소유자, 기존 카드의 owner·카드사·끝 번호 변경, 사용자 별칭 입력, NotFound·stale version·중복 claim·중간 실패, 퇴역 / 생성·수정·삭제·매칭·과거 검색 / 권한·identity 직접 변경과 별칭은 write 0건, 끝 번호는 claim·card 원자 갱신, 퇴역은 목록·매칭 제외와 claim 해제, 과거 거래 검색 증거·카드 문서 보존, 일반 사용자 복구 Command 없음 | CARD-005, DEC-059 |
| T-MER-003 | 현재·목표 | 네 match type의 쉼표 OR 키워드, 대소문자·공백이 다른 가맹점, keyword와 같은 memo만 존재 / 매칭 / 정규 merchant token 하나가 맞으면 mapping 적용하고 memo만 같으면 불일치 | MER-001, MER-003 |
| T-MER-004 | 목표 | OR 표현이 다른 두 exact 규칙의 같은 정규 키워드와 같은 non-exact priority를 동시 생성·수정 / 저장 / exact token·priority claim별 한 규칙만 성공하고 loser는 무변경 충돌 | MER-004, DEC-042 |
| T-MER-005 | 목표 | 겹치는 contains 규칙 여러 개와 고유 priority, 활성·비활성 전체 ID·누락·중복·타 가구·다른 유형 재정렬, stale version, snapshot 순서 교환·중간 실패 / 매칭·재정렬 / 최고 priority 하나만 적용되고 유효한 완전 집합만 전부 commit, 실패는 rule·claim·version rollback하며 중간 동률 없음 | MER-002, MER-004, DEC-042 |
| T-MER-006 | 현재·목표 | 존재하는 지출·수입, expected version, Actor 가구, 기억 on/off, 같은 정규 exact 규칙 있음, commit 실패 / 기존 거래 카테고리 수정 / 지출+기억만 규칙·claim과 거래를 원자 갱신하고 중복은 기존 규칙 재사용, 수입·권한·stale·실패는 무변경 | MER-005 |
| T-MER-ENRICH-001 | 현재 명세 | 가맹점 규칙 있음·없음과 일반 결제·도시가스 / 자동 결제 초안 보정 / 규칙 우선, 규칙 없는 도시가스는 parser fixed, 그 밖에는 가구 기본 카테고리 사용 | ING-SAVE-002, MER-001, MER-003 |

Web과 Android의 `T-MER-*`, `T-CARD-*`는 같은 JSON fixture를 사용해야 합니다. `MER-007`의 archive/remap 종단 시나리오는 [카테고리·예산 모듈의 T-CAT-004](../../../household-finance/modules/categories-budget/requirements.md#8-모듈-테스트-시나리오)를 단일 원본으로 공유하며, 이 문서에서 같은 테스트 ID를 다시 정의하지 않습니다.

## 9. 코드 근거

### Web

- [등록 카드 서비스](../../../../../../web/src/lib/registeredCardService.ts)
- [카드 설정](../../../../../../web/src/components/settings/CardSettings.tsx)
- [가맹점 규칙 서비스](../../../../../../web/src/lib/merchantRuleService.ts)
- [거래 편집 화면](../../../../../../web/src/components/expense/ExpenseEditModal.tsx)

### Android

- [등록 카드 관리 Application](../../../../../../functions/src/contexts/payment-capture/configuration/application/registeredCardManagementApplication.ts)
- [가맹점 규칙 Command Application](../../../../../../functions/src/contexts/payment-capture/configuration/application/merchantRuleCommandApplication.ts)

### Functions

- [Shortcut 카드·owner 판정](../../../../../../functions/src/adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery.ts)
