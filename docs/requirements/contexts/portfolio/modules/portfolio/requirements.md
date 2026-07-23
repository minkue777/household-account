# 자산 포트폴리오 모듈 요구사항

> 상위 Bounded Context: [Portfolio](../../requirements.md)  
> 아키텍처 역할: Core Domain / Application  
> 상세 설계: [모듈 상세 설계](design.md)  
> 상태와 테스트 표기 규칙은 [공통 요구사항 규약](../../../../governance/conventions.md)을 따릅니다.  
> 이 문서는 `AST-*` 요구사항의 단일 소유 문서입니다.

## 1. 독립 모듈 책임

자산 포트폴리오 모듈은 가구가 보유한 자산 계정의 생명주기와 자산 가치의 공통 계산 규칙을 소유합니다. 자산 유형별 세부 처리와 무관하게 자산을 생성·수정·정렬·논리 삭제하고, 운영상 오삭제 복구 경계를 분리하며, active 자산의 부호 있는 합계와 날짜별 스냅샷 조회 모델을 일관되게 제공합니다. 별도 비활성화 기능은 제공하지 않습니다.

다른 모듈은 `assets` 문서를 직접 수정하지 않고 이 모듈의 공개 명령을 사용합니다. 보유종목 평가, 자동 납입·상환처럼 잔액을 바꾸는 기능도 계산 결과만 전달하며, 자산 Aggregate의 최종 저장 책임은 이 모듈에 둡니다.

## 2. 포함/제외 범위

### 포함

- 예적금·주식·코인·부동산·금·대출 자산 계정 CRUD와 정렬
- 활성 자산 필터와 대출의 음수 부호 규칙
- 운영자만 복구할 수 있는 자산 논리 삭제와 별도 수동 영구 purge 경계
- 총자산·금융자산·유형별·소유자별 스냅샷 조회
- 저장 이력과 오늘의 실시간 잔액을 합성하는 차트 조회 모델
- 직전 scope가 사라진 날의 명시적 0원 스냅샷 전이
- 운영 가구에 demo·sample 자산을 쓰지 않는 배포 경계

### 제외

- 주식·코인·금 보유종목과 외부 시세 조회: [보유종목·시장 데이터 모듈](../holdings-market-data/requirements.md)
- 적금 자동 납입과 대출 자동 상환: [자산 자동화 모듈](../asset-automation/requirements.md)
- 배당 이벤트와 연간 배당 스냅샷: [배당 모듈](../dividends/requirements.md)
- 통계 기간 선택과 차트 표현: [통계 모듈](../../../../supporting-platform/modules/reporting/requirements.md)
- 가구 멤버의 생성·이름 변경·권한 관리

## 3. 소유 데이터

| 데이터 | 소유권과 불변식 |
|---|---|
| `assets` | 자산 Aggregate의 단일 쓰기 소유자입니다. 이름은 필수이며 `householdId`, 유형, 소유자, 통화, 잔액, 생명주기 상태와 순서를 관리합니다. |
| `asset_history` | 날짜별 자산 스냅샷의 조회 계약을 소유합니다. 예약 작업은 공개 스냅샷 기록 명령을 통해서만 씁니다. |
| 자산 가치 계산 | 활성 자산만 합산하고 대출은 절댓값의 음수로 계산하는 순수 정책입니다. |

현재 물리 컬렉션에서 Web과 Functions가 함께 쓰는 부분은 목표 소유권이 아닙니다. 전환 중에는 기존 저장 형식을 호환하되 모든 Writer를 포트폴리오 Application API 뒤로 모읍니다.

## 4. 공개 계약·의존 모듈

### 공개 계약

- 사용자 계약: `CreateAsset`, `UpdateAsset`, `ReorderAssets`, `DeleteAsset`
- 관리자·운영 계약: `ListDeletedAssets`, `RestoreDeletedAsset`, `RequestPermanentAssetPurge`
- `ListAssets(householdId)`와 활성 여부를 명시하는 조회 조건
- `ApplyAssetBalance(assetId, balance, costBasis?, reason, idempotencyKey)`
- `CalculatePortfolioTotals(assets)`
- `RecordAssetSnapshot(scope, date, balance, changeAmount)`
- `QueryAssetHistory(period, scope)`와 오늘의 실시간 포인트 합성

### 의존 모듈

- 가구 모듈: `householdId` 범위와 안정적인 소유자 식별자 제공
- 보유종목·시장 데이터 모듈: 계좌 평가 결과를 `ApplyAssetBalance`로 전달
- 자산 자동화 모듈: 납입·상환 결과를 멱등 키와 함께 전달
- 외부 운영 모듈: 예약 스냅샷 실행의 실패·재시도 결과 계약

포트폴리오 모듈은 React, Firebase SDK, 시세 공급자 SDK에 의존하지 않습니다. 저장소와 시계는 포트로 주입합니다.

## 5. 요구사항

| ID | 상태 | 요구사항 | 경계·예외 | 근거 | 테스트 |
|---|---|---|---|---|---|
| AST-001 | 현재 명세 | 예적금, 주식, 코인, 부동산, 금, 대출 자산을 이름, 소유자, 통화, 잔액, 메모, 순서와 함께 관리한다. | 이름은 필수이다. 잘못된 숫자를 0으로 바꾸는 현재 UI는 검증 개선 대상이다. | [asset types](../../../../../../web/src/types/asset.ts), [AssetAddModal](../../../../../../web/src/components/assets/AssetAddModal.tsx) | U, I, E2E |
| AST-002 | 현재 명세 | 활성 자산만 합계에 포함하고 대출은 절댓값을 음수로 계산한다. | 소유자는 현재 멤버 이름 문자열이다. | [assetMath](../../../../../../web/src/lib/assets/assetMath.ts) | U |
| AST-003 | 현재 명세·결함 | 자산 순서를 결정적으로 저장한다. 현재 삭제 경로가 이력·주식·코인 보유내역을 함께 물리 삭제하는 동작은 특성화할 레거시 결함이며 목표 계약으로 유지하지 않는다. | 목표 삭제·복구·영구 purge 경계는 AST-006만 따른다. 순서 변경은 대상의 중복·누락과 version 경합을 거부하고 전체 성공 또는 전체 실패여야 한다. | [AssetList](../../../../../../web/src/components/assets/AssetList.tsx), [assetService](../../../../../../web/src/lib/assetService.ts), [DEC-017](../../../../governance/decisions.md#dec-017) | I, E2E |
| AST-004 | 현재 명세 | 날짜별 총자산, 금융자산, 유형별, 소유자별 스냅샷을 조회하고 선택 기간과 시작 baseline에 존재한 안정적인 유형·ownerRef dimension key를 함께 반환한다. | 금융자산은 부동산과 대출을 제외한다. 과거 dimension은 현재 active Asset·Profile 목록으로 제한하지 않고 명시적 0원도 유효하게 포함하며, 표시 이름은 별도 historical-display 조회로 해석한다. | [assetService](../../../../../../web/src/lib/assetService.ts), [asset stats](../../../../../../web/src/app/assets/stats/page.tsx), [DEC-058](../../../../governance/decisions.md#dec-058) | U, I, E2E |
| AST-005 | 현재 명세 | 이력 차트에 저장 이력과 오늘의 실시간 잔액을 합성하고, 중간 날짜의 Snapshot이 없으면 직전 Snapshot 값을 이어 표시한다. | 조회 시작 이전에도 Snapshot이 없으면 빈 구간이며 0이나 현재값으로 채우지 않는다. 명시적 0원 Snapshot은 유효한 carry-forward 기준이고 공백 보간은 별도 경고 없이 표시한다. | [asset stats](../../../../../../web/src/app/assets/stats/page.tsx), [DEC-048](../../../../governance/decisions.md#dec-048) | U, UI |
| AST-006 | 목표 명세 | 자산 삭제는 종속 데이터를 보존한 채 Asset을 `deleted`로 전환하고 처리·일반 조회 대상에서 제외한다. 일반 사용자는 삭제 자산을 조회하거나 복구할 수 없고, 관리자·승인된 운영 주체만 감사 사유와 정확한 assetId를 지정해 `active`와 기존 종속 데이터를 되살린다. | 별도 비활성화 기능은 제공하지 않고 기존 `isActive=false`는 운영 복구 가능한 `deleted`로 변환한다. 삭제 기간의 자동화는 소급하지 않고 복구일 이후 최초 실행일부터 재개한다. 자동 hard purge는 없으며 별도 요청의 `RequestPermanentAssetPurge`만 영구 삭제를 시작하고 `purging` 이후에는 복구할 수 없다. 기존 DividendEvent와 AnnualDividendProjection은 가구 금융 이력이므로 영구 Asset purge에서도 유지한다. | [assetService](../../../../../../web/src/lib/assetService.ts), [DEC-017](../../../../governance/decisions.md#dec-017), [DEC-052](../../../../governance/decisions.md#dec-052) | U, I, E2E, 보안 E2E |
| AST-007 | 결함 | production 사용자 가구에는 sample·demo 자산을 생성하는 Command·버튼·공개 함수를 제공하지 않는다. | fixture seed가 필요하면 production과 분리된 demo tenant·개발 build에서만 실행하고 demo 표식·단일 Unit of Work·결정적 제거 경로를 갖춘다. 현재 빈 자산 화면에서 실제 가구에 샘플 8건을 순차 생성할 수 있다. | [assets page](../../../../../../web/src/app/assets/page.tsx), [assetService](../../../../../../web/src/lib/assetService.ts) | C, UI, 보안 E2E |
| AST-008 | 목표 명세 | `AssetSnapshotProjector`는 total·financial과 현재·직전 owner/type scope의 합집합을 기록하여 사라진 scope에는 명시적 0원을 저장한다. | 자산이 전혀 없는 가구도 total·financial 0원을 기록한다. 0원은 `NoData`가 아니다. 첫 Canonical Snapshot의 legacy 호환 `changeAmount`는 직전 Legacy Snapshot 잔액을 기준으로 계산하며, 직전 Canonical 부재를 0원으로 해석해 전체 잔액을 변동으로 기록하지 않는다. | [firebaseAssetSnapshotProjection](../../../../../../functions/src/adapters/firebase/portfolio/firebaseAssetSnapshotProjection.ts), [asset stats](../../../../../../web/src/app/assets/stats/page.tsx) | U, I, E2E |
| AST-009 | 목표 명세 | Asset의 명의는 표시 이름이나 memberId가 아니라 `{ kind: 'household' }` 또는 `{ kind: 'profile', profileId }`의 안정적인 `ownerRef`로 저장하고 명의자별 합계·Snapshot도 profileId를 dimension key로 사용한다. 자산 도넛 그래프 위에는 `전체 / 활성 명의자들 / +` 필터를 두며 `+`로 dependent 명의자를 추가한다. | profileId는 같은 가구의 Access `AssetOwnerProfile`이어야 한다. 일반 자산 UI에는 명의자 삭제를 제공하지 않고 관리자만 dependent 프로필을 논리 보관한다. 보관된 프로필은 신규 자산 선택에서 제외하지만 기존 자산·과거 Snapshot 조회는 유지하며 공동 자산은 가짜 프로필 대신 `household`를 선택한다. | [DEC-037](../../../../governance/decisions.md#dec-037) | U, C, UI, I, 보안 E2E |

세부 유형은 예적금의 예금·적금·보험, 금의 실물·주식, 대출의 신용·주택담보·전세를 지원합니다. 대출 상환 방식은 원리금균등, 원금균등, 만기일시입니다.

## 6. 모듈 결함

- 자산 입력 UI 일부가 잘못된 숫자를 검증 오류로 거부하지 않고 0으로 바꿉니다.
- 현재 자산 삭제가 종속 이력·보유종목을 물리 삭제해 오조작을 복구할 수 없으며, 일부 삭제 실패 시 고아·부분 데이터가 남을 수 있습니다.
- `assets.owner`가 멤버 이름 문자열에 결합되어 이름 변경이 여러 컬렉션의 연쇄 수정으로 번집니다.
- `asset_history`에 Functions의 활성 Writer와 Web의 dormant Writer가 함께 존재하므로 단일 쓰기 계약이 필요합니다.
- 빈 자산 화면에서 production 가구에 현실적인 샘플 자산을 직접 생성할 수 있고 순차 쓰기 중 실패하면 일부 sample만 남을 수 있습니다. (`AST-007`)
- 마지막 owner·type 자산이 사라지면 해당 scope의 0원 snapshot이 생성되지 않아 과거 값이 계속 표시될 수 있습니다. (`AST-008`)

## 7. 관련 DEC

- [DEC-017: 자산 삭제와 운영 복구](../../../../governance/decisions.md#dec-017) — 일반 삭제는 종속 데이터를 보존하는 논리 삭제이고 일반 사용자는 복구할 수 없습니다. 오삭제 복구와 영구 purge는 각각 별도 관리자·운영 명령으로 분리합니다.
- [DEC-037: 자산 명의자 프로필 분리](../../../../governance/decisions.md#dec-037) — Asset은 household/profile typed 참조를 저장하고 도넛 필터의 `+`로 비로그인 명의자를 추가합니다.
- [DEC-048: 자산 이력 공백 표시와 Position history 보존](../../../../governance/decisions.md#dec-048) — 중간 공백은 직전 Snapshot으로 이어 표시하고 최초 Snapshot 전은 비워 두며 Position history는 수동 purge 전까지 보존합니다.
- [DEC-053: 외화 자산 KRW 환산](../../../../governance/decisions.md#dec-053) — Holdings가 최신 사용 가능 Quote·환율을 시각 차이 제한 없이 조합하고 Core는 provenance가 있는 KRW valuation만 반영합니다.
- [DEC-058: 과거 자산 통계 dimension](../../../../governance/decisions.md#dec-058) — 선택 기간 Snapshot에 존재한 유형·ownerRef를 현재 자산 삭제·프로필 보관과 무관하게 통계 필터에 제공합니다.
- 자산 생성 시 자동 처리 기준은 [DEC-011](../../../../governance/decisions.md#dec-011)에 따라 자산 생성 계약에도 영향을 줍니다.

## 8. 모듈 테스트 시나리오

### Canonical 테스트

| 테스트 ID | 종류 | Given / When / Then | 연결 요구사항 |
|---|---|---|---|
| T-AST-001 | 특성화 | 활성 자산과 대출 / 집계 / 대출 음수·부동산 제외 금융자산 | AST-002, AST-004 |
| T-AST-002 | 목표·보안 | Position·자동화·paid 배당 이력이 있는 active 자산과 레거시 `isActive=false` 자산, 일반 사용자와 운영 관리자 / 삭제·마이그레이션·운영 복구 및 별도 영구 purge / deleted 동안 모든 처리·일반 조회에서 제외되고 일반 사용자 복구·삭제 목록 조회는 거부되며, 운영 복구 후 active와 이력이 돌아오고 영구 purge 뒤에도 기존 paid 배당과 연간 합계는 동일함 | AST-006, DEC-017, DEC-052 |
| T-AST-003 | 목표·보안 | production build의 빈 실제 가구와 demo build의 격리 tenant / sample 진입점 조회·실행 / production에는 버튼·public Command·write가 없고 demo만 표식 있는 원자 seed·제거 가능 | AST-007 |
| T-AST-004 | 목표 | 전날에만 owner A·type stock이 있고 오늘 자산이 0개인 가구 또는 직전 Canonical 없이 Legacy Snapshot만 있는 첫 전환일 / snapshot projection / 사라진 dimension은 명시적 0원이며 첫날 legacy `changeAmount`는 직전 Legacy 잔액 대비 실제 차이임 | AST-008 |
| T-AST-005 | 목표·보안 | 로그인 Member 프로필·아이 dependent 프로필·가구 공동 자산, 일반 사용자와 관리자 / 자산 생성·수정·집계·삭제 surface·도넛 필터 렌더링 / ownerRef와 Snapshot key는 안정 ID이고 `전체 / 명의자들 / +`가 표시되며 일반 UI에는 삭제가 없다. 관리자 보관 뒤에도 기존·과거 조회는 유지되고 신규 선택에서만 제외된다. | AST-009, HH-011, DEC-037 |
| T-AST-006 | 목표 | 현재 deleted 자산의 type과 archived profile owner가 과거·baseline Snapshot에만 존재 / 기간 이력 조회 / 현재 목록과 무관하게 stable type·ownerRef dimension 반환, 0원 보존, Snapshot 부재·실패와 구분 | AST-004, AST-006, AST-009, DEC-058 |
| T-AST-007 | 목표 | 지원하는 6개 자산 유형·허용 세부 유형·활성 동일 가구 명의자·통화·잔액·메모·순서와 빈 이름·NaN·Infinity·숫자 문자열·잘못된 유형·통화·순서·archived/타 가구 명의자 / 자산 생성 / 정상 값은 손실 없이 생성하고 잘못된 값은 0이나 기본값으로 보정하지 않는 ValidationError와 write 0건 | AST-001, AST-009 |
| T-AST-008 | 특성화·목표 | 중복·누락 자산 ID 순서, stale version과 정상 전체 순서, 종속 Position 삭제 실패 / 재정렬과 레거시 물리 삭제 / 잘못된 순서·stale version은 원자 거부하고 정상 순서는 version과 함께 한 번 변경하며 레거시 삭제의 부분 실패 위험을 기록한다. 목표 Writer는 논리 삭제만 수행하고 물리 삭제를 호출하지 않는다. | AST-003, AST-006 |
| T-AST-009 | 목표 | 오늘 저장 snapshot·실시간 잔액, 시작 전 이력 없음, 중간 gap, 명시적 0원 / 자산 이력 조회 / 오늘 점은 live 값 하나이며 최초 snapshot 전은 비우고 이후 gap은 0원을 포함한 직전 성공값을 유지 | AST-005, AST-008, DEC-048 |

### 상세 시나리오

| 시나리오 | 수준 | 연결 요구사항 |
|---|---|---|
| 활성 예적금 100원, 부동산 500원, 대출 30원이 있으면 총자산은 570원이고 금융자산은 100원이다. | U | AST-002, AST-004 |
| 레거시 `isActive=false`와 목표 deleted 자산은 총액·유형별·소유자별 합계에서 모두 제외하고, 운영 관리자가 복구하면 active로 다시 포함한다. | U | AST-002, AST-004, AST-006 |
| 일반 사용자가 삭제 자산 목록을 조회하거나 `RestoreDeletedAsset`을 호출하면 존재 여부를 노출하지 않고 write 0건으로 거부한다. | 보안 E2E | AST-006 |
| paid 배당이 있는 자산을 영구 purge해도 기존 DividendEvent와 연간 배당 합계는 변경되지 않는다. | I, E2E | AST-006, DIV-001, DEC-017 |
| 레거시 자산 물리 삭제 중 종속 자료 하나의 삭제가 실패하면 부분 삭제가 발생할 수 있음을 특성화하고 목표 Writer에서는 호출하지 않는다. | I | AST-003, AST-006 |
| 같은 날짜의 저장 스냅샷과 오늘 실시간 잔액을 합성할 때 오늘 포인트를 중복 생성하지 않는다. | U, UI | AST-005 |
| 이름이 비어 있거나 금액이 유효한 숫자가 아닌 자산 생성 명령은 검증 오류를 반환한다. | U, C | AST-001 |
| 기간 시작 이전에 Snapshot이 없으면 최초 Snapshot 전까지 비워 두고, 최초 Snapshot 이후 누락 날짜는 직전 값을 이어 표시하며 명시적 0원 뒤에는 0원을 유지한다. | U | AST-005, AST-008, DEC-048 |
| 마지막 owner·type 자산이 삭제되어도 직전 scope와 현재 scope 합집합에 0을 기록하고 차트가 과거 값을 유지하지 않는다. | U, I | AST-008 |
| 도넛 필터의 `+`에서 아이 이름을 추가하면 로그인 Member나 알림 대상은 늘지 않고 자산 입력 명의자 선택지와 필터에 같은 profileId로 나타난다. | UI, I | AST-009, HH-011 |

## 9. 코드 근거

- [자산 타입과 저장 모델](../../../../../../web/src/types/asset.ts)
- [자산 서비스](../../../../../../web/src/lib/assetService.ts)
- [자산 금액 계산](../../../../../../web/src/lib/assets/assetMath.ts)
- [자산 추가 화면](../../../../../../web/src/components/assets/AssetAddModal.tsx)
- [자산 목록](../../../../../../web/src/components/assets/AssetList.tsx)
- [자산 통계 화면](../../../../../../web/src/app/assets/stats/page.tsx)
