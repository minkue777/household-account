# 결제 설정 모듈 상세 설계

> 설계 대상: [`CARD-*`, `MER-*` 요구사항](requirements.md#5-요구사항) 12개  
> 상위 Context: [Payment Capture](../../requirements.md)  
> 공통 형식: [모듈 상세 설계 규약](../../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

이 문서는 등록 카드와 가맹점 규칙을 서버 권위 기준정보로 옮기기 위한 구현 계약입니다. 카드 정규화·유일성·정렬과 가맹점 매칭·우선순위·치환은 이 모듈의 Domain Policy 한 곳에서만 결정합니다. Web, Android, Shortcut, Payment Intake는 공개 Query 결과와 공용 fixture를 소비하며 같은 규칙을 다시 구현하지 않습니다.

설계 권위는 [요구사항](requirements.md), Accepted 결정, [목표 아키텍처](../../../../../architecture/target-clean-architecture.md#3-아키텍처-드라이버), 이 문서 순입니다. 이 문서는 요구사항 ID를 새로 만들지 않으며 11절에서 12개 소유 ID를 모두 테스트에 연결합니다.

## 2. 모듈 경계와 책임

### 2.1 소유 책임

- `CardRegistry`: 가구·안정적인 `memberId`별 등록 카드, 표시 순서, 유일성 claim을 소유합니다.
- `MerchantRuleSet`: 가구별 활성 규칙, match type, 우선순위, mapping과 유일성 claim을 소유합니다.
- 카드사 라벨, 마지막 네 자리, 마스킹 토큰과 가맹점 키워드의 정규화 Policy를 소유합니다.
- category mapping을 저장하기 전에 Category Catalog의 공개 참조 계약으로 유효성을 확인합니다.
- 레거시 `owner` 이름, `exactMatch`, `category`를 현재 모델로 읽는 Mapper를 소유합니다.

### 2.2 소유하지 않는 책임

- Android 알림 출처와 원문 parser, Shortcut message parser는 각 입력 모듈이 소유합니다.
- `CaptureEnvelope`, DEC-003 fingerprint, 거래 생성·취소는 Payment Intake와 Ledger가 소유합니다.
- 카테고리 정의·archive·삭제 정책은 Category Catalog가 소유합니다.
- 멤버 신원과 표시 이름 변경은 Access가 소유합니다. 이 모듈은 안정적인 `memberId`만 저장합니다.

다른 모듈은 이 모듈의 Domain 타입, Repository, 물리 컬렉션 이름을 import할 수 없습니다. 경계 원칙은 [데이터 소유권](../../../../cross-cutting/data-ownership.md#5-금지할-직접-의존)을 따릅니다.

## 3. 공개 계약

모든 외부 Command는 [공통 `CommandEnvelope`와 `ActorContext`](../../../../governance/module-design-standard.md#3-공통-application-계약)를 사용합니다. 아래 DTO는 `public.ts`와 versioned schema에서만 노출합니다.

### 3.1 공개 DTO

```ts
type CardCompany = string; // 지원 라벨 schema가 허용한 값
type CardLastFour = string; // "" 또는 숫자 네 자리; 생성 전 정규화

interface RegisteredCardReadModel {
  cardId: string;
  householdId: string;
  ownerMemberId: string;
  cardCompany: CardCompany;
  lastFour: CardLastFour;
  orderIndex?: number;
  lifecycleState: 'active' | 'retired';
  version: number;
}

type MerchantMatchType = 'exact' | 'startsWith' | 'endsWith' | 'contains';

interface MerchantRuleBaseInput {
  keyword: string;
  isActive?: boolean;
  mapping: {
    merchant?: string;
    categoryId?: string;
    memo?: string;
  };
}

type MerchantRuleInput =
  | (MerchantRuleBaseInput & { matchType: 'exact'; priority?: never })
  | (MerchantRuleBaseInput & {
      matchType: Exclude<MerchantMatchType, 'exact'>;
      priority: number;
    });

interface MerchantMappingResult {
  matched: boolean;
  ruleId?: string;
  merchant: { kind: 'preserve' } | { kind: 'replace'; value: string };
  category: { kind: 'preserve' } | { kind: 'replace'; categoryId: string };
  memo: { kind: 'preserve' } | { kind: 'replace'; value: string };
}
```

`memo`가 누락되거나 빈 문자열인 레거시 mapping은 `preserve`로 변환하여 Android parser memo를 유지합니다. Firestore 문서 DTO와 레거시 필드는 공개 계약에 노출하지 않습니다.

### 3.2 Input Port

| 이름·종류 | 호출자 | 입력 | 결과 | 권한 | 일관성·멱등성 |
|---|---|---|---|---|---|
| `RegisterCard` Command | Web 설정 | `ownerMemberId`, `cardCompany`, 선택 `lastFour` | `Success<RegisteredCardReadModel>` 또는 `Duplicate(existingId)` | `paymentConfiguration:write`와 같은 가구 Membership | active 카드와 uniqueness claim을 한 transaction에 생성; envelope key로 결과 재생 |
| `UpdateRegisteredCard` Command | Web 설정 | `cardId`, 선택 `lastFour`, `expectedVersion` | 갱신 카드 또는 `Conflict`·`Duplicate`·`IdentityChangeRejected` | 동일 | 끝 번호 변경 시 새 claim 생성·카드 갱신·이전 claim 해제를 한 transaction에 수행; owner·cardCompany 변경 금지 |
| `DeleteRegisteredCard` Command | Web 설정 | `cardId`, `expectedVersion` | `Success<RegisteredCardReadModel>`·`NotFound`·`Conflict` | 동일 | 카드를 `retired`로 바꾸고 활성 claim을 같은 transaction에서 해제; 카드 문서는 보존하고 같은 key 재시도는 저장 결과 재생 |
| `ReorderCards` Command | Web 설정 | `ownerMemberId`, 순서가 완전한 `cardIds`, 각 `expectedVersion` | 정렬된 카드 목록 | 동일 | 해당 멤버 카드 집합을 한 transaction에서 0부터 재번호; 요청 순서 hash로 멱등 |
| `ListMemberCards` Query | Web, Payment Intake | `householdId`, `ownerMemberId` | active 카드만 결정적으로 정렬한 목록 | `paymentConfiguration:read` | 쓰기 없음; retired 카드는 제외하고 장애를 빈 목록으로 축약하지 않음 |
| `ResolveCard` Query | Payment Intake | 필수 `ownerMemberId`, `cardCompany`, `cardToken?` | `Eligible(canonicalCardEvidence?)`·`Unmatched(reason)` | 내부 `paymentCapture:resolve` | owner 범위 snapshot만 조회; 여러 일치는 허용하되 저장 순서로 canonical card를 임의 선택하지 않음 |
| `CreateMerchantRule` Command | Web 설정, 거래 편집 흐름 | `MerchantRuleInput` | 생성 규칙 또는 `Duplicate`·`PriorityConflict` | `paymentConfiguration:write` | exact token/non-exact priority claim과 규칙 원자 생성; envelope key로 재생 |
| `UpdateMerchantRule` Command | Web 설정 | `ruleId`, 변경 값, `expectedVersion` | 갱신 규칙 또는 `Conflict`·`Duplicate`·`PriorityConflict` | 동일 | claim 교체·규칙 갱신 원자 수행 |
| `DeleteMerchantRule` Command | Web 설정 | `ruleId`, `expectedVersion` | `Success<void>` | 동일 | 규칙과 claim 원자 삭제 |
| `ReorderMerchantRules` Command | Web 설정 | non-exact matchType, 해당 유형의 활성·비활성 전체 ruleIds 순서·expectedVersions | 재정렬 규칙 목록 또는 `Conflict`·`RuleSetMismatch` | 동일 | 전체 집합 검증 후 priority claim·규칙을 한 transaction에서 재번호 |
| `ListMerchantRules` Query | Web 설정 | `householdId`, 선택 active filter | 결정적 표시용 규칙 목록 | `paymentConfiguration:read` | match type 범위 순서 후 non-exact priority 내림차순, exact normalized keyword, ruleId |
| `ResolveMerchantMapping` Query | Payment Intake | 원 가맹점, 선택 원 memo | `Matched(mapping)`·`Unmatched`·`ContractFailure` | 내부 `paymentCapture:resolve` | 한 repository snapshot에 순수 `MerchantRuleSelectionPolicy` 적용; canonical 동률 불가, legacy 충돌 임의 선택 금지 |
| `RemapMerchantRuleCategoryReferences` Process Command v1 | Category Archive Process | fromCategoryId, toDefaultCategoryId, processId, cursor, limit | `Success<CategoryReferenceRemapPage>`, `Conflict`, `RetryableFailure` | `category-reference-remap` SystemActor | 규칙 page와 receipt 한 UoW; `processId:merchant-rules:cursor`로 멱등 |

Command의 공통 오류는 규약의 typed Result 중 필요한 항목만 사용합니다. 안정적인 모듈 오류 code는 `INVALID_CARD_COMPANY`, `LAST_FOUR_REQUIRED`, `CARD_IDENTITY_CHANGE_REQUIRES_REREGISTRATION`, `CARD_RETIRED`, `CARD_SET_MISMATCH`, `INVALID_MATCH_TYPE`, `EMPTY_KEYWORD`, `EXACT_PRIORITY_NOT_ALLOWED`, `NON_EXACT_PRIORITY_REQUIRED`, `MERCHANT_RULE_PRIORITY_CONFLICT`, `MERCHANT_RULE_SET_MISMATCH`, `MERCHANT_RULE_CONFLICT`, `INVALID_CATEGORY_REFERENCE`, `IDEMPOTENCY_PAYLOAD_MISMATCH`입니다.

## 4. Domain 모델과 불변식

### 4.1 `CardRegistry`

`RegisteredCard`는 `cardId`, `householdId`, immutable `ownerMemberId`·`CardCompany`, `CardLastFour`, `orderIndex`, `lifecycleState(active|retired)`, `version`을 가집니다. `CardCompany`는 자유 입력 문자열이 아니라 표준 표시 라벨로 매핑되는 code입니다.

- 입력 번호는 비숫자를 제거한 뒤 마지막 네 자리만 남깁니다.
- 번호 없는 카드는 해당 owner·카드사의 모든 번호에 일치하는 wildcard입니다. 같은 owner·카드사에는 번호 없는 wildcard를 하나만 허용합니다.
- 유일성 key는 active 카드에 대해서만 `(householdId, ownerMemberId, normalizedCardCompany, normalizedLastFour)`의 versioned hash입니다. retired 카드는 claim을 점유하지 않습니다.
- 카드 라벨과 토큰 비교는 양쪽을 정규화한 뒤 수행합니다. `x`, `*`, `＊`는 wildcard 증거로 해석하되 최종 결과에는 등록 카드의 정규 번호만 반환합니다.
- 여민전은 세종지역화폐 라벨로 호환 정규화합니다. label-only 허용 여부는 카드사 정의 fixture에 명시합니다.
- 명시 `orderIndex`가 있는 카드를 먼저 오름차순으로 두고, 나머지는 일반 카드, 번호 없는 간편결제, 카드사, 번호, `cardId` 순으로 정렬합니다.
- `ResolveCard`는 active 상태와 `ownerMemberId`로 후보 집합을 먼저 제한한 뒤 카드사·token을 비교합니다. 다른 멤버와 retired 카드는 읽거나 일치 개수에 포함하지 않습니다.
- 본인 후보 0건은 `Unmatched`, 1건 이상은 `Eligible`입니다. exact token 일치를 wildcard보다 우선해 유일한 최상위 후보가 있을 때만 그 카드의 canonical evidence를 반환합니다. 최상위 후보가 여러 건이면 `Eligible`이지만 canonical evidence는 비워 parser evidence를 유지하며, Repository 오류는 불일치로 변환하지 않습니다.
- [DEC-059](../../../../governance/decisions.md#dec-059)에 따라 카드사와 `ownerMemberId`는 immutable identity입니다. 두 값을 바꾸는 update payload는 거부하고 기존 카드를 퇴역한 뒤 새 `cardId`로 등록해야 합니다. 끝 번호만 수정할 수 있으며, 끝 번호 변경은 uniqueness claim과 card version을 원자 교체합니다.
- 사용자 자유 입력 카드 이름·별칭은 모델과 공개 DTO에 두지 않습니다. 화면 표시명은 `CardCompany` code의 표준 라벨과 선택적인 `lastFour`를 조합하며, 검색용 과거 거래 증거는 Ledger가 거래 생성 시점의 값을 보존합니다.
- 퇴역은 복구 가능한 UI 상태가 아니라 과거 증거를 남기는 논리 삭제입니다. 일반 목록·정렬·매칭과 재정렬 집합에서는 제외하고 별도 복구 Command는 제공하지 않으며, 같은 identity를 다시 쓰려면 새 카드로 등록합니다.
- 끝 번호 수정이나 퇴역은 과거 Ledger 거래에 저장된 immutable capture evidence와 lineage를 다시 쓰지 않습니다.

### 4.2 `MerchantRuleSet`

`MerchantRule`은 `ruleId`, 가구, 원 키워드, 정규 키워드 목록, match type, non-exact priority, 활성 상태, mapping, version을 가집니다.

- 키워드는 쉼표로 나누고 각 항목의 앞뒤 공백과 대소문자를 정규화합니다. 전체 keyword가 비거나 빈 OR token이 하나라도 있으면 검증 오류이며 조용히 제거하지 않습니다. 정규 keyword는 원 가맹점 문자열에만 적용하고 memo는 후보 선택 입력으로 사용하지 않습니다.
- exact는 정규화된 OR 키워드 각각에 `(householdId, exactKeywordToken)` claim을 만들며 같은 token이 다른 exact 규칙에 속할 수 없습니다. exact에는 priority를 저장하지 않습니다.
- startsWith·endsWith·contains는 키워드가 겹칠 수 있지만 같은 match type의 priority는 비활성 규칙까지 포함해 가구 안에서 유일해야 하며 `(householdId, matchType, priority)` claim으로 강제합니다.
- 비활성 규칙은 평가하지 않습니다.
- `MerchantRuleSelectionPolicy`는 먼저 `exact → startsWith → endsWith → contains` 순서로 일치 후보가 있는 가장 좁은 match type 하나를 선택합니다. 이 단계에서는 priority를 비교하지 않습니다.
- exact 후보는 token claim 때문에 최대 하나입니다. non-exact 후보가 여러 개면 같은 유형에서 가장 높은 고유 priority 하나를 적용하고 merchant·category·memo를 서로 독립적으로 `preserve` 또는 `replace`합니다.
- canonical snapshot에서 exact token이나 non-exact priority 충돌을 발견하면 `ContractFailure(MERCHANT_RULE_CONFLICT)`이며 `createdAt`, ruleId, snapshot 순서로 승자를 만들지 않습니다.
- `ListMerchantRules`의 ruleId는 같은 표시 key가 생긴 손상 데이터에서도 화면 순서를 안정화하기 위한 마지막 정렬일 뿐 Resolve tie-break가 아닙니다.
- category를 치환하는 규칙은 유효한 Category Reference 없이는 생성·수정할 수 없습니다.
- regex는 허용하지 않습니다.

### 4.3 레거시 해석

Persistence Mapper만 `matchType` 누락 시 `exactMatch=true`를 `exact`, 그 외를 `contains`로 변환하고 `mapping` 누락 시 `category`를 mapping으로 변환합니다. Domain과 공개 DTO에는 레거시 필드를 두지 않습니다.

## 5. Application Use Case 상세

### 5.1 카드 변경 Use Case

1. Adapter가 인증 정보를 `ActorContext`로 만들고 가구 일치·write capability를 검증합니다.
2. `ownerMemberId`가 해당 가구의 활성 멤버인지 Access 공개 Query로 확인합니다.
3. 카드사와 번호를 정규화하고 번호 없는 예외·필수값을 검증합니다.
4. uniqueness hash를 계산하고 Unit of Work 안에서 claim을 `create`합니다.
5. 등록·수정·퇴역과 claim 변경을 함께 commit합니다. 수정·퇴역은 `expectedVersion` precondition을 확인합니다.
6. 같은 idempotency key와 payload hash는 저장 결과를 재생하고 다른 payload는 `Conflict(IDEMPOTENCY_PAYLOAD_MISMATCH)`입니다.
7. transaction retry callback 안에서는 로그 전송이나 다른 외부 부수 효과를 실행하지 않습니다.

`UpdateRegisteredCard`는 먼저 `RegisteredCardIdentityPolicy`로 변경 필드를 분류합니다. `ownerMemberId`·`cardCompany` 변경 또는 공개 schema에 없는 자유 입력 별칭은 검증 단계에서 거부하며 기존 claim과 카드 문서를 수정하지 않습니다. `lastFour` 변경은 새 claim을 먼저 확보한 뒤 카드 version 갱신과 이전 claim 해제를 한 UoW에서 수행하며, 중복·stale이면 전체 rollback합니다.

`DeleteRegisteredCard`는 active 카드만 `retired`로 전환하고 활성 claim을 해제합니다. 이미 retired인 카드에 같은 idempotency key를 재사용하면 저장 결과를 재생하며, 다른 명령으로 다시 활성화할 수 없습니다. 보존된 카드 문서는 과거 capture를 변경하지 않고 설명하기 위한 감사 자료이며 일반 사용자의 목록 계약에는 노출하지 않습니다.

`ReorderCards`는 입력 `cardIds`가 해당 멤버의 현재 활성 카드 ID 집합과 정확히 같고 expected collection version이 일치해야 합니다. 누락·중복·타 멤버 카드·stale version은 typed 오류이며 아무 카드도 변경하지 않습니다. commit 실패도 모든 order와 collection version을 원상 유지합니다.

### 5.2 카드·가맹점 Resolve Use Case

Resolve는 조회 실패와 불일치·규칙 데이터 충돌을 구분합니다. 카드 Resolve는 [DEC-028](../../../../governance/decisions.md#dec-028)에 따라 요청받은 `ownerMemberId`의 Repository snapshot만 읽고 순수 Policy를 한 번 적용합니다. 본인 카드가 하나 이상 일치하면 eligibility는 성공이며, canonical card가 유일하게 결정될 때만 정규화된 최소 증거를 반환합니다. 가맹점 Resolve가 legacy·손상 규칙 충돌을 발견하면 Payment Intake는 mapping을 적용하지 않고 `ContractFailure`로 중단하며 임의 기본 category 적용으로 숨기지 않습니다. Android와 Shortcut은 이 결과를 소비하고 카드·가맹점 정책을 로컬에서 재평가하지 않습니다.

### 5.3 가맹점 규칙 변경 Use Case

1. Actor와 가구 쓰기 권한을 검증합니다.
2. keyword·match type·mapping을 정규화하고 exact의 priority 입력을 거부하며 non-exact의 양의 정수 priority를 필수 검증합니다.
3. category 치환이 있으면 Category Catalog의 `GetCategoryReference`를 transaction 밖에서 확인합니다.
4. Unit of Work에서 exact token claim 또는 non-exact priority claim과 규칙 문서를 함께 생성·교체·삭제합니다. OR exact rule은 모든 token claim을 확보해야만 생성됩니다.
5. `remember` 선택은 입력만으로 거래를 만들지 않고 Ledger에서 조회한 기존 거래 ID·expected version·Actor 가구를 검증합니다. 지출 category 갱신과 `CreateMerchantRule`의 exact claim·규칙 생성 또는 기존 규칙 재사용을 조정 UoW에서 원자 확정합니다. 수입에는 이 명령을 노출하지 않고, 권한·stale version·중간 실패는 거래와 규칙을 모두 원상 유지합니다.
6. 성공 후 별도 비동기 Event는 필요하지 않습니다. 즉시 소비자는 다음 Resolve에서 새 규칙을 봅니다.
7. `ReorderMerchantRules`는 요청 match type이 non-exact인지와 입력 ruleIds가 해당 유형의 활성·비활성 전체 현재 집합과 정확히 같은지 확인하고, 요청 순서대로 겹치지 않는 priority를 한 UoW에서 재번호합니다. 집합·version 불일치나 write 한도 초과는 write 0건입니다.

### 5.3 카테고리 참조 변경

1. Category Archive Process 전용 SystemActor와 processId, from/to category가 서로 다른지 검증합니다.
2. `fromCategoryId`를 mapping하는 규칙을 active 여부와 무관하게 안정적인 ruleId 순서로 한 page 읽습니다.
3. category mapping만 `toDefaultCategoryId`로 바꾸고 merchant·memo mapping, match 조건, priority, active 상태는 유지합니다.
4. 변경 page와 process receipt를 같은 UoW에 저장하며 같은 processId·cursor 재호출은 저장된 결과를 재생합니다.
5. 이미 변경된 규칙은 성공으로 수렴하고 Repository 실패는 다음 cursor를 포함한 `RetryableFailure`로 반환합니다.

## 6. Port 설계

| Output Port | 책임 | 주요 결과·fixture |
|---|---|---|
| `CardRegistryRepository` | active·retired 카드 snapshot, active claim 생성·교체·해제, version precondition | found, empty, retired, duplicate claim, stale version, retry fixture |
| `MerchantRuleRepository` | 규칙 snapshot, claim, 레거시 persistence DTO mapping | current, legacy `exactMatch/category`, malformed document fixture |
| `PaymentConfigurationUnitOfWork` | 동일 transaction에서 repository 변경과 command receipt 수행 | callback 2회 실행, rollback, contention |
| `MembershipQueryPort` | owner member가 대상 가구에 속하고 활성인지 확인 | active, missing, other household |
| `CategoryReferencePort` | mapping category의 존재·활성 여부 확인 | active, archived, missing, retryable failure |
| `Clock`, `IdGenerator`, `HashingPort` | 시간·ID·versioned uniqueness hash 생성 | 고정 clock과 결정 hash fixture |
| `CommandReceiptRepository` | idempotency payload hash와 typed 결과 재생 | 동일/상이 payload fixture |
| `ProcessReceiptRepository` | category remap page 결과 재생 | processId+cursor, payload 불일치 fixture |
| `ObservabilityPort` | 개인정보 없는 operation·latency·오류 code 기록 | token·번호 전체·member 이름 기록 금지 |

Repository Fake와 Firestore Adapter에는 같은 Conformance Suite를 적용합니다.

## 7. 저장·트랜잭션·동시성

목표 논리 저장은 `registeredCards/{cardId}`, `registeredCardClaims/{claimHash}`, `merchantRules/{ruleId}`, `merchantRuleClaims/{claimHash}`, command receipt입니다. 물리 경로는 Adapter 내부이며 공개 계약이 아닙니다.

- 카드·규칙 문서에는 tenant key, schema version, aggregate version, 생성·수정 시각을 둡니다. 카드에는 lifecycle state와 선택 `retiredAt`을 추가합니다.
- exact token claim은 정규화 token의 versioned hash와 ruleId만, non-exact priority claim은 `(matchType, priority)` hash와 ruleId만 보존합니다.
- 카드 생성은 active claim `create`와 본문 `create`, 끝 번호 수정은 새 claim `create`·본문 version update·이전 claim delete, 퇴역은 본문 state update·활성 claim delete를 같은 transaction에서 수행합니다. 카드 본문은 일반 삭제 Command에서 물리 삭제하지 않습니다.
- `ReorderCards`는 한 멤버 카드 수가 Firestore transaction 한도를 넘지 않는지 사전 검증합니다.
- `ReorderMerchantRules`도 해당 match type의 전체 규칙 수가 transaction 한도를 넘지 않는지 사전 검증하고, priority claim 교체와 모든 rule version 갱신을 한 번에 commit합니다.
- 현재 이름 기반 `owner`는 Access가 제공한 member-name→memberId reconciliation으로 backfill한 뒤 read를 전환합니다. 전환 중 Legacy Mapper는 이름을 읽을 수 있지만 신규 Writer는 `ownerMemberId`만 기록합니다.
- 레거시 규칙은 먼저 호환 read와 shadow comparison을 배포하고 V2 backfill 후 legacy write를 중단합니다. 잔존 문서 0건과 fixture 통과 전에는 Mapper를 제거하지 않습니다.

이 모듈의 변경은 다른 Context 비동기 효과를 요구하지 않으므로 기본적으로 Outbox Event를 만들지 않습니다.

## 8. Event·Projection·외부 연동

- 카드·규칙 목록은 소유 모듈 Query 또는 명시된 읽기 전용 계약으로 제공합니다. 클라이언트가 Canonical 문서를 직접 쓰지는 못합니다.
- Payment Intake는 `ResolveCard`, `ResolveMerchantMapping`을 동기 호출합니다. 반환 타입은 Entity가 아닌 최소 Read Model입니다.
- Category Catalog와 Access는 동기 Output Port이며 이 모듈이 해당 저장소 경로를 알지 않습니다.
- 향후 설정 변경 Event가 필요해도 확정 문서와 같은 transaction의 `OutboxAppendPort`로 추가하며 Event payload에 카드 전체 번호·멤버 표시 이름을 포함하지 않습니다.
- TypeScript·Kotlin은 [schema와 비식별 fixture만 공유](../../../../../architecture/target-clean-architecture.md#122-typescriptkotlin-사이의-공유)합니다.

## 9. 오류·보안·관측성

- 모든 Command·Query는 Actor의 `householdId`와 입력 tenant가 일치하는지 확인합니다. 타 가구 ID는 `NotFound`로 존재를 누출하지 않거나 보안 정책이 정한 `Forbidden` code로 일관되게 반환합니다.
- 카드 전체 번호는 입력 후 즉시 마지막 네 자리로 축소하고 저장·trace·오류 payload에 원문을 남기지 않습니다.
- Repository 장애는 `RetryableFailure` 또는 `ContractFailure`이며 빈 카드 목록·규칙 불일치로 축약하지 않습니다. canonical 동률은 불변식 위반인 `MERCHANT_RULE_CONFLICT`이고 mapping을 적용하지 않습니다.
- category 참조 실패는 `INVALID_CATEGORY_REFERENCE`; 중복 claim은 `Duplicate`; stale version은 `Conflict`입니다.
- 관측 필드는 `commandId`, `householdHash`, operation, result code, retry count, latency, schema version으로 제한합니다.
- 보안 기준은 [보안과 개인정보 경계](../../../../cross-cutting/security-privacy.md)를 따르며 Canonical 설정 컬렉션의 클라이언트 write를 거부합니다.

## 10. 목표 패키지 구조

```text
functions/src/contexts/payment-capture/configuration/       # 목표
  domain/
    entities/card-registry.ts
    entities/merchant-rule-set.ts
    value-objects/card-last-four.ts
    value-objects/merchant-keyword.ts
    policies/card-matching-policy.ts
    policies/merchant-matching-policy.ts
  application/
    commands/register-card.ts
    commands/manage-cards.ts
    commands/manage-merchant-rules.ts
    queries/resolve-card.ts
    queries/resolve-merchant-mapping.ts
    ports/in/
    ports/out/
  adapters/out/firestore/
  public.ts

contracts/
  schemas/commands/payment-configuration/                  # 목표
  fixtures/payment-configuration/                         # 비식별 card/merchant fixture

web/src/features/payment-configuration/                   # 목표 소비 Adapter
android/core/contracts/                                   # 생성 Kotlin DTO; 정책 구현 없음
```

`public.ts`는 Input Port, DTO, typed Result와 안정 오류 code만 export합니다. Domain, Repository, Firestore Mapper는 export하지 않습니다.

## 11. 테스트 설계

공통 Fake·계층 원칙은 [모듈 상세 설계 규약](../../../../governance/module-design-standard.md#7-테스트-설계-규약)을 사용합니다. Web·Android·Functions는 같은 비식별 JSON fixture를 소비합니다.

| 요구사항 ID | 테스트 수준 | 테스트 대상 | 핵심 fixture/경계값 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| [CARD-001](requirements.md#등록-카드) | Domain, Repository | 번호 정규화·저장 Mapper | 숫자·공백·하이픈이 섞인 긴 번호 | 숫자 마지막 네 자리와 memberId만 저장 | `T-CARD-002` |
| [CARD-002](requirements.md#등록-카드) | Domain, Emulator | 번호 없는 wildcard·uniqueness claim | 동일 조합 동시 2회, 일반 카드사·간편결제 빈 번호 | owner·카드사별 wildcard 한 카드와 한 claim, 다른 요청 `Duplicate` | `T-CARD-003` |
| [CARD-003](requirements.md#등록-카드) | Domain, Application, Contract | 카드 결정 정렬·ReorderCards | 명시 순서·일반·간편결제·동률 ID, 완전·누락·중복·타 멤버 집합, stale version·commit 실패 | 조회 계약 순서가 런타임별로 같고 유효한 전체 집합만 고유 order로 commit, 실패는 전체 rollback | `T-CARD-004` |
| [CARD-004](requirements.md#등록-카드) | Domain, Contract, Application | owner-scoped 카드 resolve | 본인 0·1·여러 건, 타 멤버 동일 카드, wildcard, 여민전 라벨, 도시가스 | 본인 1건 이상이면 `Eligible`; 타 멤버 무관; 유일한 최상위 후보일 때만 canonical 번호 반환 | `T-CARD-001` |
| [CARD-005](requirements.md#등록-카드) | Domain, Application, Emulator | Actor 경계·RegisteredCardIdentityPolicy·UpdateRegisteredCard·DeleteRegisteredCard | 타 가구/소유자, NotFound, owner·cardCompany·끝 번호·자유 입력 별칭, stale version, uniqueness 충돌·commit 실패, active·retired | 권한·identity 변경·별칭 입력 write 0건, 끝 번호 원자 갱신, 퇴역 뒤 목록·매칭 제외와 claim 해제, 카드 문서·과거 검색 evidence 보존, 복구 Command 없음 | `T-CARD-005` |
| [MER-001](requirements.md#가맹점-규칙) | Domain, Contract | merchant-only match type·쉼표 OR 정규화 | 네 타입, 혼합 대소문자·공백·빈 OR 항목, keyword와 같은 memo만 존재 | 정규 merchant token 하나라도 맞을 때만 match하고 memo만 같으면 불일치 | `T-MER-001`, `T-MER-003` |
| [MER-002](requirements.md#가맹점-규칙) | Domain, Contract | MerchantRuleSelectionPolicy | 낮은 priority exact와 높은 priority contains, 네 type 동시 일치, 겹치는 contains, snapshot 순서 교환 | 좁은 type 우선, 선택 non-exact type의 최고 priority 하나, 저장소 순서 무관 | `T-MER-001`, `T-MER-005` |
| [MER-003](requirements.md#가맹점-규칙) | Domain, Contract | 세 필드 독립 mapping | 필드 누락, 빈 memo, merchant/category 치환 | preserve/replace가 명시적으로 구분 | `T-MER-001`, `T-MER-003` |
| [MER-004](requirements.md#가맹점-규칙) | Emulator, Repository, UI | exact token·non-exact priority claim, ReorderMerchantRules | OR exact token 겹침, 같은 type/priority 동시 생성·수정, 완전 집합 재정렬, 중간 실패 | 충돌 loser write 0건, 고유 priority 전체 commit 또는 rollback | `T-MER-004`, `T-MER-005` |
| [MER-005](requirements.md#가맹점-규칙) | Application, E2E | 기존 거래 편집 후 기억 흐름 | 지출·수입, Actor·expected version, remember on/off, 규칙 중복·commit 실패 | 존재 지출+remember만 거래·rule/claim을 원자 갱신, 중복은 기존 규칙 재사용, 나머지는 무변경 | `T-MER-006` |
| [MER-006](requirements.md#가맹점-규칙) | Mapper Contract | 레거시 호환 read | `exactMatch/category`, active=false, current mapping, 빈 keyword·잘못된 category/priority·regex 값 | 유효 문서는 현재 모델과 같은 mapping; malformed·regex는 typed ContractFailure | `T-MER-002` |
| [MER-007](requirements.md#가맹점-규칙) | Application, Repository, Contract | RemapMerchantRuleCategoryReferences | 활성·비활성 규칙, 이미 변경된 규칙, page 실패·재시도 | category만 default로 수렴하고 다른 mapping·조건은 불변 | `T-CAT-004` |

추가 공통 suite는 동일 idempotency key의 동일·상이 payload, 타 가구 Actor, stale version, callback 2회 실행, Repository 장애와 빈 결과 구분을 검증합니다.

## 12. 확정 정책과 구현 순서

- 가맹점 규칙 선택·중복 정책은 [DEC-042](../../../../governance/decisions.md#dec-042)로 확정되었습니다. `MerchantRuleSelectionPolicy`는 좁은 match type을 먼저 고르고 non-exact 유형 안에서 고유 priority를 적용합니다.
- 등록 카드의 identity·수정·퇴역 범위는 [DEC-059](../../../../governance/decisions.md#dec-059)로 확정되었습니다. `RegisteredCardIdentityPolicy`는 카드사·소유자 변경과 자유 입력 별칭을 거부하고 끝 번호만 수정하며, 일반 삭제는 과거 증거를 보존하는 `retired` 전환으로 처리합니다.

아래 구현 상세도 데이터 조사 후 확정해야 합니다.

- 카드사 라벨 목록과 label-only/wildcard 허용 행렬은 운영 데이터와 `T-CARD-001` fixture로 동결합니다.
- 레거시 이름 owner를 memberId로 연결하지 못한 문서의 수동 reconciliation 절차가 필요합니다.
- 레거시 규칙 제거 시점은 잔존 문서 0건과 `T-MER-002` 통과 뒤로 둡니다.

구현 순서는 (1) 현재 Web·Android 공용 fixture 추출, (2) 순수 정규화·매칭 Policy와 characterization test, (3) 서버 Query Port와 Legacy Mapper, (4) uniqueness claim·Command, (5) Web writer 전환, (6) Android·Shortcut의 직접 조회 제거, (7) category archive page remap Command와 receipt 추가, (8) backfill과 레거시 writer 제거 순입니다.
