# Legacy → Canonical 운영 마이그레이션 Runbook

이 Runbook은 `SYS-009`의 운영 전용 migration 절차입니다. 실행기는
`functions/scripts/migrate-runtime.mjs`에만 있으며 Web·Android 및 배포되는
Functions export에서는 호출할 수 없습니다. 이 문서의 명령은 운영 DB에 실제로
실행했다는 뜻이 아니며, 배포 전에 Emulator에서 같은 절차를 검증해야 합니다.

## 1. 범위와 보장

지원하는 migration kind와 schema scope는 각각 아래 한 가지입니다.

- `legacy-runtime-to-household-canonical-v1`
- `legacy-flat-v1:household-canonical-v1`

한 실행은 `project + household + migrationId + migration kind + schema scope +
operator`를 모두 명시합니다. legacy flat collection은 `householdId == 지정 가구`
query로만 읽으며, householdId가 없거나 다른 문서는 현재 가구로 추정하지 않습니다.

대상은 다음과 같습니다.

- `expenses` → `households/{householdId}/ledgerTransactions`
- `assets` → 가구 하위 `assets`
- `categories` → 가구 하위 `categories`와 `categorySettings/default`
- `recurring_expenses` → 가구 하위 `recurringPlans`
- `stock_holdings`, `crypto_holdings` → Asset 하위 `positions`
- `registered_cards` → 가구 하위 `registeredCards`와 카드 identity claim
- `merchant_rules` → 가구 하위 `merchantRules`와 exact token/non-exact priority claim
- 유형이 명시된 `balances(type=localCurrency)` → 가구 하위
  `localCurrencyBalances/{localCurrencyType}`
- 가구 문서의 `homeSummaryConfig`·지역화폐 선택 → `homePreferences/home`
- legacy Asset 자동 납입·대출 상환 설정 → `assetAutomationPlans`와 create-only
  `assetAutomationPlanRevisions`
- 명시적으로 결정한 정기 거래 creator → 감사용
  `recurringCreatorMigrationReceipts`

dry-run은 업무 문서를 바꾸지 않지만 운영 plan과 후보·미해결 보고서를
`operationsMigrationPlans`에 영속화합니다. 적용은 저장된 동일 plan hash,
`--confirm APPLY`, 동일 scope, 현재 checkpoint가 모두 일치해야 시작됩니다.

## 2. Mapping manifest 준비

가구 ID 원문은 manifest에 넣지 않고 SHA-256만 넣습니다. PowerShell 예시는 다음과
같습니다.

```powershell
$household = "실제-household-id"
$bytes = [Text.Encoding]::UTF8.GetBytes($household)
$hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLower()
```

manifest 형식은 다음과 같습니다. 필요한 항목만 채웁니다.

```json
{
  "version": 1,
  "householdIdHash": "64자리-sha256",
  "memberReferences": { "legacy 표시 이름": "member-id" },
  "missingCreatorMemberId": "생성자가 비어 있는 과거 기록의 확인된 member-id",
  "ledgerCreators": { "legacy-expense-document-id": "member-id" },
  "ledgerNotificationRequesters": { "legacy-expense-document-id": "member-id" },
  "recurringCreators": { "legacy-plan-document-id": "member-id" },
  "registeredCardOwners": { "legacy-card-document-id": "member-id" },
  "merchantRulePriorities": { "legacy-non-exact-rule-id": 10 },
  "assetOwners": { "legacy owner 표시 이름": "asset-owner-profile-id" },
  "positionAssets": { "legacy-position-document-id": "asset-id" },
  "positionMarkets": { "legacy-stock-document-id": "KRX" },
  "assetAutomationFirstApplicableMonths": {
    "asset-id_savings-contribution": "2026-08"
  },
  "localCurrencyTypes": {
    "legacy-balance-document-id": "gyeonggi"
  },
  "localCurrencyPreferredDocuments": {
    "gyeonggi": "legacy-balance-document-id"
  },
  "homeSelectedLocalCurrencyType": "gyeonggi",
  "defaultCategoryId": "category-id"
}
```

`memberReferences`는 이름을 자동 추정하는 기능이 아닙니다. 운영자가 실제 Member를
확인해 명시한 매핑입니다. `missingCreatorMemberId`는 운영자가 해당 가구의 생성자 없는
과거 Ledger 거래와 정기 거래를 모두 한 Member에게 귀속하기로 확인한 경우에만
사용합니다. 이 값은 creator 필드가 완전히 비어 있는 문서에만 적용하며, 이미 이름이나
Member ID가 있는 기록은 덮어쓰지 않습니다. 문서별 예외는 `ledgerCreators` 또는
`recurringCreators`가 우선합니다. 모든 creator 매핑은 같은 가구의 보존된 Member ID만
허용하며 Scheduler나 현재 접속자를 대신 넣지 않습니다. 자산 명의자는 존재하는
`assetOwnerProfile`로만 연결합니다. 처리 월 기록이 없는 자동 납입·상환 설정은
현재 잔액에 이미 포함되었는지 알 수 없으므로 최초 적용 월을 명시하지 않으면 전체
apply가 중단됩니다.

기본 카테고리는 manifest의 `defaultCategoryId`, 기존 가구 문서의
`defaultCategoryKey`, 유일한 legacy `isDefault=true` 순서로 결정합니다. legacy
`defaultCategoryKey`와 manifest 값은 Firestore 문서 ID뿐 아니라 카테고리의 안정적인
`categoryId`/`key`로도 확인합니다. 어느 근거로도 하나를 확정할 수 없으면 임의
선택하지 않고 manifest 입력을 요구합니다.

카드 owner는 `registeredCardOwners` 또는 확인된 `memberReferences`로만 연결합니다.
카드 identity가 중복되거나 가맹점 규칙의 exact token/non-exact priority claim이
충돌하면 임의의 승자를 고르지 않습니다. non-exact 레거시 규칙에 양의 정수
priority가 없으면 `merchantRulePriorities`로 고유 값을 지정합니다. 지역화폐 유형이 없는 레거시 문서는
`localCurrencyTypes`로 명시하고, 같은 유형의 문서가 여러 개면
`localCurrencyPreferredDocuments`로 보존할 문서 하나를 지정해야 합니다. 홈 화면의
기존 선택값이 지원 유형이 아니면 `homeSelectedLocalCurrencyType`을 명시합니다.

## 3. Dry-run

```powershell
cd functions
npm run migrate:runtime -- `
  --mode dry-run `
  --project PROJECT_ID `
  --household HOUSEHOLD_ID `
  --migration-id 2026-07-runtime-v1 `
  --migration-kind legacy-runtime-to-household-canonical-v1 `
  --schema-scope legacy-flat-v1:household-canonical-v1 `
  --operator OPERATIONS_ACTOR_ID `
  --mapping .\private\mapping.json
```

출력에는 household ID·표시 이름·secret·manifest 원문이 포함되지 않습니다.
`unresolvedCount`가 0이 아니면 `requiredManifestField`, `referenceHash`, typed code를
확인해 manifest를 보완하고 dry-run을 다시 실행합니다. 새 manifest는 새 plan
hash를 만듭니다.

## 4. Apply와 재개

dry-run 출력의 hash와 checkpoint를 그대로 사용합니다.

```powershell
npm run migrate:runtime -- `
  --mode apply `
  --project PROJECT_ID `
  --household HOUSEHOLD_ID `
  --migration-id 2026-07-runtime-v1 `
  --migration-kind legacy-runtime-to-household-canonical-v1 `
  --schema-scope legacy-flat-v1:household-canonical-v1 `
  --operator OPERATIONS_ACTOR_ID `
  --plan-hash DRY_RUN_PLAN_HASH `
  --checkpoint DRY_RUN_PLAN_HASH:0 `
  --confirm APPLY
```

각 page는 source fingerprint와 가구 범위를 transaction 안에서 다시 확인합니다.
target은 create-only이며 이미 같은 결정이 반영된 경우만 replay로 인정합니다.
`merge-missing`은 기존 creator 필드가 비어 있을 때만 사용하고 다른 값은 덮어쓰지
않습니다. page receipt와 `planHash:nextIndex` checkpoint가 같은 transaction에
기록되므로 실패 후 출력된 최신 checkpoint로 다시 실행할 수 있습니다.

현재 운영 전환에서 확정된 생성자 없는 과거 기록의 일괄 매핑은 다음과 같습니다.
원본 household ID나 Member ID는 문서에 남기지 않고 실제 manifest에서만 연결합니다.

- `또니망고네`: 민규 Member
- `익태송희네`: 익태 Member

이미 creator가 있는 기록은 위 일괄 매핑 대상이 아닙니다. 표시 이름 alias는 별도의
`memberReferences`로 기존 당사자에게 연결합니다.

## 5. Reconciliation과 전환 gate

완료 시 다음 세 묶음을 비교합니다.

- source: 실제 변경 결정에 참여한 legacy 문서 수, 금액 합계, source fingerprint hash
- expected target: plan의 target 결정 수, 금액 합계, 결정 hash
- actual target: apply 뒤 같은 target 필드가 일치한 수, 금액 합계, 결정 hash

금액 합계는 Ledger·정기 거래 금액, Asset 잔액, Category budget, Position의 마지막
가격(없으면 평단) 평가액, 자동화 Plan·Revision 금액을 검증용으로 합산한 값입니다.
업무 통계가 아니라 migration drift 탐지 지표입니다. target count·금액·결정 hash 중
하나라도 다르면 plan은 `failed/MISMATCH`이고 전환하지 않습니다.

마지막으로 read-only 비교를 실행합니다.

```powershell
npm run reconcile:runtime -- --project PROJECT_ID --household HOUSEHOLD_ID
```

`ledger`, `assets`, `categories`, `recurring`, `positions`가 모두 `MATCH`이고 자동화
Plan·Revision 수동 표본 검증까지 끝나야 합니다. 카드·가맹점 규칙·지역화폐·홈
환경설정은 이 migration plan 자체의 target count·금액·결정 hash `MATCH`를 추가
전환 조건으로 사용합니다. 모든 조건이 끝난 뒤에만 compatibility reader 제거
후보로 분류합니다. 이 CLI는 영구 삭제·legacy source 삭제·배포를 수행하지 않습니다.

## 6. 별도 전환 항목

| 항목 | 처리 방식 | 이유·운영 조건 |
|---|---|---|
| 카드·가맹점 규칙 | 이 CLI로 본문과 uniqueness claim을 함께 이관 | 현재 호환 reader는 조회만으로 canonical 문서를 만들지 않습니다. |
| 유형이 확인된 지역화폐 잔액 | 이 CLI로 이관 | 유형을 추정하지 않으며 중복 문서는 manifest 선택이 필요합니다. |
| 홈 환경설정 | 이 CLI로 이관 | 기존 가구 필드의 두 카드와 선택된 지역화폐를 그대로 정규화합니다. |
| Member·membership·principal claim | 이 CLI에서 일괄 이관하지 않음 | Google UID는 레거시 데이터만으로 추론할 수 없습니다. 기존 사용자가 보존된 로컬 가구/멤버 정보로 최초 Google 로그인할 때 `ClaimLegacyMembership`이 원자 연결합니다. 해당 연결을 먼저 완료하거나 운영자가 별도 확인해야 합니다. |
| 기존 FCM registration token | FID로 이관하지 않음 | 토큰에서 Firebase Installation ID를 복원할 수 없습니다. 지원 모바일 클라이언트가 로그인 후 설치 endpoint를 다시 등록해야 합니다. 데스크톱은 알림 대상이 아닙니다. |
| TTL `expiresAt`·index | 이 migration kind에서 처리하지 않음 | 별도 release prerequisite/backfill 절차로 검증합니다. |

Member 연결이 끝나지 않아 creator·owner를 확정할 수 없는 가구는 typed unresolved로
apply 전체가 중단됩니다. 운영자가 UID나 표시 이름을 추정해서 principal claim을
미리 만들면 안 됩니다. FCM token/FID 역시 같은 값이나 새 주소로 간주해 복사하지
않습니다.
