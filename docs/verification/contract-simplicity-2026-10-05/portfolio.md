# Portfolio 계약별 단순화

기준 SHA는 `676731d9abda95439afc2dfd827690029d89e048`입니다. 자산 포트폴리오, 보유종목·시장 데이터, 배당, 자산 자동화의 공개 계약을 검토했습니다. 자산 통계는 이미 완료된 이전 계약의 결과를 유지하며 이번 감축 범위에서 제외합니다. [직전 감사](../simplicity-2026-10-05/finance.md)와 [완료 기록](../simplicity-2026-10-05/completion.md)을 재사용하고, 현재 호출자와 후속 구현을 대조했습니다. 모든 기존 파일을 이번에 새로 전수 독해했다는 의미는 아닙니다.

## 변경 결과

- 자산 생성·수정, 보유종목 입력, 자동화 설정의 오류 선택을 순서 있는 직접 반환으로 바꿨습니다. 첫 오류 우선순위와 실패 receipt를 보존합니다.
- 자동화 transaction의 열 가지 설정 이상 경로가 동일한 `needs-attention` 저장 함수를 사용합니다. 각각의 조건·오류 코드·targetId와 자산 및 다음 실행일 보존은 그대로입니다.
- 실물 금의 확정 시세를 effect로 복제하던 state를 원본 Asset에서 바로 계산합니다. 입력 중 수량은 독립 초안으로 유지합니다.
- 실제 호출자가 없는 평가·배당·정렬·공급자 목록 정책을 제거했습니다. 자동화 날짜 검사만 사용하던 factory도 제거하고 같은 실제 정책 함수를 직접 검사합니다. 현재 runtime Writer와 공개 타입 계약은 유지합니다.

## 공개 계약 판정

| 모듈 | 계약 | 판정과 보존 경계 |
|---|---|---|
| Portfolio | CreateAsset, UpdateAsset | 변경: 입력 검증의 첫 실패를 직접 반환. 원자 저장·expectedVersion·receipt·명의 검증 유지 |
| Portfolio | ReorderAssets | 미사용 shadow 함수 제거. 실제 명령의 완전한 ID 집합·중복/누락·전체 version 원자 검사 유지 |
| Portfolio | DeleteAsset, ListDeletedAssets, RestoreDeletedAsset | 유지: 논리 삭제, 운영자 권한, 감사 사유, 종속 자료 보존, 삭제 기간 제외 자동화 재개 |
| Portfolio | RequestPermanentAssetPurge, ContinueAssetPurge | 유지: 명시적 요청·participant checkpoint·멱등 page와 paid 배당 보존 |
| Portfolio | ListAssets, QueryPortfolio | 유지: active·가구 범위, 마지막 확정값과 오류/미조회 구분 |
| Portfolio | ApplyAssetBalance, ApplyAssetValuation, CalculatePortfolioTotals | 실제 runtime 평가와 합계 정책 유지. Position·부모 자산 원자 저장과 대출 부호/금융 제외 규칙 보존 |
| Portfolio | RecordAssetSnapshot | 유지: 현재·직전 dimension 합집합과 사라진 scope의 명시적 0원 |
| Portfolio | QueryAssetHistory와 liveToday | 이전 자산 통계 계약에서 완료. 이번 추가 수정 제외 |
| Holdings | AddHolding, UpdateHolding, DeleteHolding, ManagePosition | 변경: 검증 실패 선택만 단순화. optional patch·초기 이력·부모 평가·두 version과 receipt 원자성 유지 |
| Holdings | ListHoldings, QueryPositionHistory | 유지: 실제 snapshot과 보존 이력 조회. 최근접·동률 과거 우선·모든 계좌 증거 및 승인 없는 이관 fallback 제거 금지 |
| Holdings | SearchStocks, SearchCrypto, SearchInstruments | 유지: 실제 기기 catalog의 전체 주식 결과와 30개씩 표시, 서버 호환/코인 최대 10개, 결정적 순서·빈 입력 오류 |
| Holdings | GetStockQuote, GetFundNav, GetCryptoQuote, GetGoldQuote, GetQuote | 미사용 routing 목록만 제거. 실제 공급자 선택·단위·NoData/실패·마지막 성공값 유지. 실물 금 표시 중복 state 제거 |
| Holdings | CalculateHoldingValue, CalculateAccountValuation, RevaluePositions | 미사용 병행 평가 제거 및 실제 account policy 직접 export. 실제 환율 provenance·펀드 1000좌 단위·반올림 유지 |
| Holdings | RefreshAccountPrices, RefreshHouseholdPrices, RunDailyAssetValuation | 유지: 외부 조회 후 자산별 transaction, scope single-flight·30초 window·실패 대상 재시도·page checkpoint |
| Holdings | PublishInstrumentCatalog | 유지: 검증된 gzip 객체→manifest CAS→receipt 기준 보존. 이전 업로드 입력 단순화 재사용 |
| Holdings | PurgeAssetHoldingsParticipant | 유지: 대상 assetId page와 receipt; 논리 삭제에서는 보유·이력 write 없음 |
| Dividends | CollectDividendDisclosures, RefreshDividendEvents | 유지: discovery와 nonterminal lifecycle sweep은 대상과 실패 의미가 달라 합치지 않음 |
| Dividends | UpsertDividendAnnouncement, AdvanceDividendStatus | 미사용 eligibility wrapper만 제거. 실제 event identity·다중 계좌 수량 증거·미지급 정정/취소·paid 불변 유지 |
| Dividends | RebuildAnnualDividendSnapshot, RebuildAnnualDividend | 미사용 계산 제거. 실제 repository의 event·12개월 projection·receipt·outbox 원자 저장 유지 |
| Dividends | QueryDividendSnapshot, GetAnnualDividend, QueryDividendEvents | 미사용 shadow read 정책 제거. 실제 canonical 조회의 scope·NoData/실패 구분 유지 |
| Dividends | EstimateUpcomingDividends | 실제 Web 배당 read model 유지. 현재 수량 추정과 확정 event ID 중복 제외는 이전 통계 정비 결과 재사용 |
| Automation | EvaluateSavingsContribution, CalculateEffectivePaymentDate | test-only factory 제거. 실제 납입일·월말·윤년·첫 활성화 월 계산은 동일 정책을 직접 검사 |
| Automation | CalculateLoanPrincipalPayment, EvaluateLoanRepayment, EvaluateAutomationMonth | 실제 정책 유지. 원 단위 이자 반올림·잔액 초과 상환 제한·미지원 만기일시상환 구분 |
| Automation | ConfigureAssetAutomation | 입력 실패 선택 단순화. effective revision·first activation·version·원자 저장 유지 |
| Automation | ProcessDueAssetAutomation, RunContribution, RunRepayment | 동일 transaction의 needs-attention 저장만 단일화. 월 execution key·오래된 due 우선·실패 시 nextDueDate 보존 |
| Automation | GetAutomationPlan | 실제 Asset 읽기와 설정 투영 유지. 목표 port를 새 일반 API로 연결하지 않음 |
| Automation | PurgeAssetAutomationParticipant | 유지: 소유 Plan·Revision·Execution만 page 삭제. 논리 삭제·복구에서 이력 보존 |

## 검증 상태

관련 Functions 검증과 Web Jest 8파일 40개, Functions 실행/검사 및 Web TypeScript 검사를 통과했습니다. 실물 금의 첫 렌더 회귀는 변경 전 실패·변경 후 성공을 확인했습니다. root가 실제 Firebase SDK 4파일 33개(자동화·원장·지역화폐·Shortcut)를 통과했습니다. 최종 통합/브라우저/배포 결과는 상위 작업 기록에서 추적합니다. Functions와 Web 변경이며 Android 실행 코드 변경은 없습니다.

## 고정 소스 범위와 코드량

각 계약은 아래 실제 소유 파일 묶음에 연결합니다. 전체 경로와 파일별 기준/최종 줄수는 [재현 가능한 소스 목록](portfolio-runtime-scope.json)에 있습니다. 파일 전체의 물리적 줄수이며 모든 전이 의존성·UI를 더한 모듈 전체 크기는 아닙니다. 같은 파일의 여러 계약은 같은 묶음을 공유합니다. 자산 통계와 이미 완료된 Web 배당 read model은 추가 감축에 포함하지 않습니다.

| 계약 묶음 | 기준 | 최종 | 판정 |
|---|---:|---:|---|
| P1 자산 생성·수정·정렬 | 689 | 608 | 81줄 감소 |
| P2 삭제·복구·purge | 1060 | 1060 | 유지 |
| P3 합계·스냅샷 | 418 | 418 | 유지 |
| P4 Web 조회·명령 | 2417 | 2417 | 유지 |
| H1 보유 CRUD·평가 | 1088 | 904 | 184줄 감소 |
| H2 공급자·가격 갱신 | 1489 | 1441 | 48줄 감소 |
| H3 검색·catalog 발행 | 1073 | 1073 | 유지 |
| H4 금 입력·시세 표시 | 140 | 130 | 10줄 감소 |
| H5 배당 보유 이력 | 303 | 303 | 유지 |
| D1 배당 수집·수량확정·전이·저장 | 1126 | 1106 | 20줄 감소 |
| D2 배당 조회 | 236 | 120 | 116줄 감소 |
| A1 자동화 설정·날짜·월 평가 | 666 | 597 | 69줄 감소 |
| A2 자동화 월별 실행 | 866 | 781 | 85줄 감소 |
| A3 운영 복구 시 자동화 재개 | 233 | 233 | 유지 |

P1은 Create/Update/Reorder, P2는 Delete/ListDeleted/Restore/RequestPurge/ContinuePurge, P3는 CalculateTotals/QueryPortfolio/RecordSnapshot, P4는 ListAssets와 명령·조회 소비자입니다. ApplyAssetBalance/ApplyAssetValuation은 P1·H1의 실제 원자 명령을 공유합니다. H1은 Add/Update/Delete/ListHoldings/CalculateHoldingValue/CalculateAccountValuation/RevaluePositions, H2는 모든 GetQuote/Refresh/DailyValuation, H3는 Search/PublishCatalog, H4는 실물 금 표시, H5는 QueryPositionHistory입니다. Holdings/Automation purge participant는 P2의 bounded participant 저장 경계를 공유합니다. D1은 Collect/Upsert/Advance/Refresh/Rebuild, D2는 QuerySnapshot/QueryEvents/GetAnnualDividend이며 실제 Web 예상 배당은 이전 통계 계약에서 완료했습니다. A1은 Configure/GetPlan 및 네 계산 정책, A2는 ProcessDue/RunContribution/RunRepayment, A3는 Restore의 삭제 기간 제외 정책입니다.

이번에 **실제로 변경한 실행 파일 14개만** 합치면 2,572→1,959줄, 613줄(23.8%) 감소입니다. 이 비율은 네 모듈 전체의 감소율이 아닙니다. 그중 실제 운영 경로의 직접 반환·중복 상태·동일 저장 동작 통합과 직접 export는 182줄, 사용되지 않는 병행 구현·test-only factory 제거는 431줄입니다. 새 실행 helper 파일이나 다른 파일로 이동한 구현은 없습니다. 동일 transaction 안의 `markNeedsAttention` 함수 비용도 변경 후 줄수에 포함합니다.

| 변경 실행 파일 | 기준 | 최종 | 감소 |
|---|---:|---:|---:|
| `functions/src/adapters/firebase/portfolio/firebaseAssetAutomationRuntimeStore.ts` | 808 | 723 | 85 |
| `functions/src/contexts/portfolio/automation/public.ts` | 93 | 52 | 41 |
| `functions/src/contexts/portfolio/core/application/portfolioAssetAutomationSynchronization.ts` | 131 | 103 | 28 |
| `functions/src/contexts/portfolio/core/application/portfolioAssetCommandApplication.ts` | 476 | 443 | 33 |
| `functions/src/contexts/portfolio/core/application/portfolioPositionPolicy.ts` | 251 | 233 | 18 |
| `functions/src/contexts/portfolio/core/domain/model/assetOrder.ts` | 69 | 21 | 48 |
| `functions/src/contexts/portfolio/dividends/domain/policies/dividendEligibilityPolicy.ts` | 69 | 49 | 20 |
| `functions/src/contexts/portfolio/dividends/domain/policies/dividendReadPolicies.ts` | 116 | 0 | 116 |
| `functions/src/contexts/portfolio/holdings/domain/policies/assetRevaluationPolicy.ts` | 44 | 0 | 44 |
| `functions/src/contexts/portfolio/holdings/domain/policies/foreignCurrencyValuationPolicy.ts` | 78 | 59 | 19 |
| `functions/src/contexts/portfolio/holdings/domain/policies/holdingValuationPolicy.ts` | 114 | 0 | 114 |
| `functions/src/contexts/portfolio/holdings/domain/policies/marketRoutingPolicy.ts` | 34 | 5 | 29 |
| `functions/src/contexts/portfolio/holdings/public.ts` | 149 | 141 | 8 |
| `web/src/lib/utils/useGoldHolding.ts` | 140 | 130 | 10 |

## 요구사항·관측 근거와 유지 결정

- [Portfolio 요구사항](../../requirements/contexts/portfolio/modules/portfolio/requirements.md) `AST-001..009`: 명령 검증·confirmed 응답, 명의, 삭제·복구·purge, 합계와 snapshot을 판정했습니다. `AST-004/005`의 화면 합성과 캐시는 앞서 완료된 자산 통계 검토를 재사용합니다.
- [Holdings 요구사항](../../requirements/contexts/portfolio/modules/holdings-market-data/requirements.md) `HOLD-001..005`, `FUND-001`, `GOLD-001/002`, `MARKET-001..006`, `JOB-AST-001..003`: 현재 Position 명령·계좌 평가·공급자·catalog·이력 조회 경로를 대조했습니다. 타입 선언에만 남은 목표 port를 새 서비스로 연결하거나 요구사항을 삭제하지 않습니다.
- [Dividends 요구사항](../../requirements/contexts/portfolio/modules/dividends/requirements.md) `DIV-001..006`, `JOB-DIV-001/002`: 현재 discovery→보유 이력 증거→Event→연간 projection의 저장/실패 경계를 유지했습니다. Web 예상 배당 합성은 앞서 완료된 동일 계약을 재사용합니다.
- [Automation 요구사항](../../requirements/contexts/portfolio/modules/asset-automation/requirements.md) `AUTO-001..003`, `LOAN-001/002`: 날짜 계산과 실제 due-plan 실행·복구·purge를 판정했습니다. 첫 활성화월, 월말 보정과 effective revision을 하나의 단순한 잔액 증감으로 바꾸지 않습니다.

삭제한 함수는 `functions/src`, `functions/test`, `web/src`, `tools`에서 전체 심볼 검색과 export를 대조했습니다. `holdingValuationPolicy`·`assetRevaluationPolicy`·`dividendReadPolicies`의 계산, `selectDividendEligibility`, `valueSourceQuoteInWon`, `quoteProvidersFor`, `dividendDisclosureProvidersFor`, `decideAssetReorder`에는 실제 소비자가 없었습니다. 실제 평가/조회/정렬 호출자는 P1·H1·H2·D1·D2에 남아 있습니다. `createAssetAutomationDatePolicy`는 날짜 정책 검사만 사용했으므로 그 검사를 실제 네 정책 함수 호출로 전환했습니다. 공개 포트의 타입과 실제로 쓰는 `isKrxGoldSpotCode`, `parseFrankfurterRate`, `selectNearestPositionSnapshots`는 유지했습니다.

[이전 명령 확정 응답](../../operations/portfolio-command-confirmation-2026-10-05.md), [실제 통계·배당 경로](../../operations/reporting-runtime-simplicity-2026-10-05.md), [Storage 발행 경계](../../operations/portfolio-storage-simplicity-2026-10-05.md), [이전 감사 FIN-05/07](../simplicity-2026-10-05/finance.md)의 검토·검증 결과를 재사용했습니다. 이미 없앤 클라이언트 버전 추정·N+1 삭제 목록·업로드 전 가상 metadata를 이번 성과에 중복 합산하지 않습니다. 이관 Position history fallback과 구 receipt 호환은 실제 기존 자료를 읽는 경로이므로 유지합니다. AssetAdd/EditModal 전체를 다시 설계하거나 원자 저장을 여러 클라이언트 요청으로 나누지 않았습니다.

## 이번 검증 상세

| 경계 | 검사와 관측 |
|---|---|
| 자산/Position 실패 우선순위 | `portfolio-runtime-store.test.ts` 36개. 실제 runtime application + Firebase adapter + InMemoryFirestore를 통과하며 여러 필드가 동시에 잘못돼도 첫 오류가 같고 업무 문서가 변하지 않음. 실패 receipt는 기존대로 기록함 |
| 날짜 정책 직접 호출 | `asset-automation-date-policy.contract.test.ts`는 factory·중복 DTO를 제거했으며 `T-AUTO-001/002`, `T-LOAN-001`의 같은 기대값을 유지 |
| 자동화 이상 상태 | 신규 `asset-automation-runtime-attention.test.ts` 9개. 실제 adapter transaction에서 정확한 code/targetId, Plan 격리만 기록, 자산·nextDueDate/version·execution·Outbox 보존을 검사. 변경 전후 모두 통과 |
| 실물 금 중복 상태 | `physicalGoldPriceDisplay.contract.test.tsx` 5개. 첫 open과 자산 전환 첫 렌더의 확정 가격, 동일 Asset 갱신 시 수량 초안 보존, 닫힘/잘못된 수량의 미확정 처리. 새 첫 렌더 검사는 변경 전 실패·변경 후 성공 |
| 관련 서버 회귀 | `test/contexts/portfolio`, runtime valuation/store, market data, projection reader와 초기 이력·정정·기존 Event 재점검·이관 이력 회귀가 통과. 최종 미사용 함수 제거 후 runtime-store/market-data 2파일 55개 추가 통과 |
| 관련 Web 회귀 | physicalGoldPriceDisplay, assetEditModalInitialPaint, holdingValuation, portfolioCommands, portfolioQueries, holdingManagerSnapshot, holdingReadPipeline, localStockInstrumentCatalog의 8파일 40개 통과 |
| 타입 | Functions 실행/검사 두 tsconfig와 Web의 `tsc --noEmit` 통과 |
| 실제 SDK | root가 `firebase-asset-automation-schedule.integration.test.ts`를 포함한 통합 4파일 33개 통과를 확인. 단위 adapter 검사를 실제 SDK 검증으로 표현하지 않음 |

초기 architecture 실행의 깨진 과거 감사 링크는 기준 SHA GitHub 링크로 고쳤습니다. Finance의 `T-LED-002` 검사 이관과 추적성 보강을 마쳤으며 최종 architecture 43개와 실제 SDK 통합 33개가 통과했습니다. 모든 최종 CI와 Web/Firebase 배포 성공을 이 문서만으로 선언하지 않습니다.
