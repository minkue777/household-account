# Portfolio Bounded Context 요구사항 지도

> 문서 유형: Business Bounded Context  
> 소유 기능 모듈: 포트폴리오, 보유종목·시세, 자산 자동화, 배당  
> 소유 요구사항: 39개  
> 목표 구조: [목표 Clean Architecture 설계](../../../architecture/target-clean-architecture.md#5-bounded-context와-기능-모듈)

## 1. 책임과 경계

Portfolio Context는 **가구가 보유한 자산 계정, Position, 자동 납입·상환, 자산 평가와 배당 상태**를 관리한다. Portfolio Core가 AssetAccount와 최종 가치의 Writer이고, Holdings·Automation·Dividends가 독립된 정책과 데이터를 소유한다.

시세·환율·공시 Provider는 Portfolio Domain 밖의 Market Data Anti-Corruption Layer다. Scheduler·retry·부분 실패 관측은 지원 Operations가 구현하며 업무 job의 대상·계산·상태 전이는 이 Context가 소유한다.

포함 범위:

- 자산 계정 CRUD·정렬·논리 삭제·운영 전용 오삭제 복구·부호 있는 합계
- 주식·ETF·수동·코인·금 Position과 평가
- 시세·환율·종목·공시의 내부 계약
- 적금 월 납입과 대출 월 상환
- 날짜별 자산 Snapshot
- DividendEvent 상태 전이와 연간 Projection

제외 범위:

- Naver·Upbit·KIND 등의 HTTP 구현과 원문 DTO
- Scheduler 런타임·공통 retry·log 구현
- 거래 원장과 지역화폐 잔액
- 통계 차트 기간·표현
- 멤버 생명주기와 권한

## 2. 내부 기능과 요구사항

| 기능 모듈 | 요구사항 | 개수 | 독립 책임 | 상세 소유 문서 |
|---|---|---:|---|---|
| 포트폴리오 | AST-* | 9 | AssetAccount 생명주기, 명의자 참조, 가치 합계, Snapshot | [포트폴리오](modules/portfolio/requirements.md) |
| 보유종목·시세 | HOLD-*, GOLD-*, MARKET-*, JOB-AST-* | 17 | Position, Market 계약, 종목 카탈로그, 자산 갱신 job | [보유종목과 시세](modules/holdings-market-data/requirements.md) |
| 자산 자동화 | AUTO-*, LOAN-* | 5 | AutomationPlan과 월 실행 | [자산 자동화](modules/asset-automation/requirements.md) |
| 배당 | DIV-*, JOB-DIV-* | 8 | DividendEvent와 Annual Projection | [배당](modules/dividends/requirements.md) |
| 합계 |  | 39 |  |  |

## 3. 공통 언어

| 용어 | 의미 |
|---|---|
| AssetAccount | 예적금·주식·코인·부동산·금·대출 등의 가구 자산 계정 |
| AssetOwnerRef | 공동 명의 `household` 또는 Access가 제공한 `profileId`를 구분하는 안정적인 자산 명의 참조 |
| Position | assetId와 instrumentId에 연결된 수량·평균단가·평가 정보 |
| Cost Basis | Position 또는 계정에 투입된 원가 |
| Quote | 공급자 형식을 제거한 시장·통화·가격·시각 계약 |
| Valuation | Position과 수동 잔액을 합산한 AssetAccount 가치 |
| AssetAutomationPlan | 적금 납입·대출 상환 설정과 최초 적용 정책 |
| Automation Execution | asset·operation·month 한 번을 보장하는 실행 claim |
| AssetSnapshot | 특정 LocalDate의 재구축 가능한 자산 합계 Read Model |
| DividendEvent | announced, fixed, paid 상태와 적격 수량·금액을 가진 배당 사실 |
| AnnualDividendProjection | DividendEvent에서 재생성하는 연도별 12개월 합계 |

## 4. Aggregate와 소유 데이터

| 기능 모듈 | Aggregate·데이터 | 핵심 불변식 | 현재 저장 |
|---|---|---|---|
| Portfolio Core | AssetAccount | 이름·유형·household/profile 명의 참조·통화·`active/deleted/purging` 생명주기·부호 | `assets` |
| Portfolio Core | AssetSnapshot | 날짜별 결정 ID, 오늘 실시간 값 중복 없음; Portfolio Core의 `AssetSnapshotProjector`만 저장 | `asset_history` |
| Holdings | Position | 수량·평균단가·현재가, 실패와 0 구분 | `stock_holdings`, `crypto_holdings` |
| Holdings | Market Contract | 국내·미국·코인·금 공급자 선택과 정규 Quote | 현재 Next/Functions provider 코드 |
| Automation | AssetAutomationPlan | 납입·상환 정책과 last/first applicable month | 현재 `assets` 혼합 필드 |
| Automation | Execution Claim | asset·operation·month 한 번 | 명시 저장 없음 |
| Dividends | DividendEvent | 결정 ID와 상태 전이, 적격 보유수량 | `dividend_events` |
| Dividends | AnnualDividendProjection | event 합계와 일치하는 12개월 배열 | `dividend_snapshots` |

Position과 Automation은 `assets`를 직접 덮어쓰지 않고 Portfolio Core의 `ApplyAssetValuation` 또는 자동화 Command를 사용한다. `AssetSnapshotProjector`는 commit된 Portfolio 조회 결과만 결정적으로 upsert하며 Scheduler·Holdings·Reporting은 `asset_history`를 직접 쓰지 않는다. 목표 V2에서는 자동화 설정·checkpoint를 별도 소유 문서로 분리한다.

## 5. Context 불변식

1. AssetAccount만 `assets` 가치와 상태의 최종 Writer다.
2. deleted·purging 자산은 총·유형·소유자 합계와 평가·자동화·신규 배당 처리에서 제외한다. 별도 비활성 상태는 두지 않는다.
3. 대출은 절댓값의 음수로 합산한다.
4. Position의 데이터 없음·공급자 실패·유효 0원 가격을 구분한다.
5. 공급자 실패를 0원으로 저장해 기존 자산 가치를 훼손하지 않는다.
6. 한 자산의 Position 변경과 Valuation 적용은 명시적 Portfolio Unit of Work를 사용한다.
7. 같은 asset·operation·month 자동화는 한 번만 반영한다.
8. 외부 HTTP 호출과 FCM·log side effect를 Firestore transaction 안에서 실행하지 않는다.
9. Snapshot과 Dividend Projection은 원천 데이터에서 결정적으로 재구축할 수 있다.
10. DividendEvent 상태는 허용된 순서로만 전이하고 같은 공시를 중복 생성하지 않는다.
11. 여러 자산 job은 대상별 성공·실패·재시도 범위를 반환한다.
12. Position 변경과 Asset valuation처럼 함께 성립해야 하는 쓰기는 Application workflow와 Portfolio Unit of Work로 먼저 commit하며 Event 전달로 강한 일관성을 완성하지 않는다.
13. Portfolio Event는 commit 이후 Snapshot·Reporting·운영 관측 같은 downstream 소비에만 사용한다.
14. 기존 DividendEvent와 AnnualDividendProjection은 Asset 삭제 대상이 아닌 가구 금융 이력이며, 원천 Asset의 논리·영구 삭제로 변경하지 않는다.
15. AssetSnapshot의 유일한 Writer는 Portfolio Core의 `AssetSnapshotProjector`이며 날짜·scope 결정 key로 멱등 upsert한다.
16. 가구·자산 영구 purge는 별도 수동 요청에서만 시작하며 같은 processId·checkpoint 재호출에 안전하고 Portfolio 소유 데이터만 page 단위로 정리한다.
17. 시세 실패 기간과 무관하게 마지막 성공 Quote와 observedAt을 평가에 사용하고, 공급자별 연속 장애·복구는 Firebase 구조화 log·영속 Health 상태·경보로 관측한다.
18. Asset과 Snapshot은 명의자 표시 이름·memberId가 아니라 `household` 또는 안정적인 profileId를 저장하며, 프로필 이름 변경·보관으로 기존·과거 참조를 수정하지 않는다.
19. 같은 공시의 미지급 DividendEvent는 안정 공시 ID를 유지한 채 최신 값으로 덮어쓰고 이전 값은 보관하지 않는다. 지급 전 명시적 취소만 Event와 Projection에서 제거하며, Provider 실패는 삭제 근거가 아니고 paid Event는 불변이다.

## 6. 공개 계약과 의존 방향

### 제공 계약

| 기능 모듈 | 주요 공개 계약 |
|---|---|
| Portfolio Core | `CreateAsset`, `UpdateAsset`, `DeleteAsset`, `RestoreDeletedAsset`, `RequestPermanentAssetPurge`, `ApplyAssetValuation`, `QueryPortfolio` |
| Holdings | `ManagePosition`, `RevaluePositions`, `QueryPositions`, `QueryPositionHistory`, `RunDailyAssetValuation`, `PublishInstrumentCatalog` |
| Asset Automation | `RunContribution`, `RunRepayment`, `EvaluateAutomationMonth`, `ProcessDueAssetAutomation` |
| Dividends | `RefreshDividendEvents`, `AdvanceDividendStatus`, `GetAnnualDividend` |
| Context Lifecycle | `PurgeHouseholdData(householdId, processId, checkpoint)` → 공통 `PurgePageResult` |

### Inbound Adapter

- Operations의 Scheduler는 `RunDailyAssetValuation`, `PublishInstrumentCatalog`, `ProcessDueAssetAutomation`, `RefreshDividendEvents`를 호출하는 **Inbound Adapter**다. `RunContribution`과 `RunRepayment`는 `ProcessDueAssetAutomation`이 target별로 조정하며 Scheduler가 due 계산 없이 직접 나열해 호출하지 않는다.
- Scheduler는 대상 계산·Position 평가·Asset 합계·자동화·배당 상태 전이를 구현하거나 Portfolio Repository를 직접 호출하지 않는다.
- Web/API Handler도 동일한 Application Inbound 계약을 사용한다.

### 소비 Output Port

- Access & Household: ActorContext와 같은 가구의 AssetOwnerProfile 검증·표시 조회
- Market Data Port: instrument search, quote, exchange rate, dividend disclosure
- Operations Output Port: retry 실행, 대상별 job result 기록, 시도별 log·metric·trace, ProviderHealth 기록·조회·경보
- Clock, UnitOfWork, Repository Port

### Downstream 소비자

- AssetSnapshotProjector: `AssetValuationChanged.v1`을 소비하는 Portfolio Core 내부 단일 Writer. Projector 입력 계약은 Context 밖으로 공개하지 않는다.
- Reporting: Portfolio와 Dividend 공개 Projection·Event의 소비자

외부 Provider Adapter는 이를 소비하는 기능 모듈이 정의한 Port를 구현한다. Scheduler는 Portfolio를 호출하는 방향이고, Portfolio가 Operations에서 소비하는 것은 retry/result/observability·ProviderHealth Output Port뿐이다. Operations가 시세 선택·자산 합계·배당 상태 전이를 소유하지 않는다.

`PurgeHouseholdData`는 AssetAccount, Position·history, Automation plan·execution, AssetSnapshot, Dividend data를 결정적인 page로 정리하고 [공통 paged purge 결과 계약](../../cross-cutting/data-ownership.md#41-공통-paged-purge-계약)을 반환한다. 일반 가구 논리 삭제에서는 호출하지 않으며 별도 승인된 Access `HouseholdPurgeProcess`의 수동 영구 삭제 요청만 허용한다.

## 7. Event와 종단 흐름

| Event | 소유 모듈 | 주요 소비자 |
|---|---|---|
| `PositionChanged.v1` | Holdings | Position history, Reporting |
| `AssetValuationChanged.v1` | Portfolio Core | AssetSnapshotProjector, Reporting |
| `AssetAutomationApplied.v1` | Automation | Reporting·운영 관측 |
| `DividendEventChanged.v1`·`DividendEventRemoved.v1` | Dividends | Annual Projection, Reporting |

Position 후보와 Asset valuation은 Event를 왕복해 완성하지 않는다. 같은 자산 범위의 Application workflow가 Portfolio Unit of Work로 Position·AssetAccount·Outbox를 먼저 commit하고, 위 Event는 확정 사실을 downstream Projection과 관측에 전달한다.

일일 자산 처리:

```text
Scheduler Inbound Adapter
  → Portfolio Application Command
  → 대상 page 조회
  → 외부 Quote를 transaction 밖에서 수집
  → 성공 Quote만 Position 후보 생성
  → 자산별 Position + Valuation 강한 일관성 commit + Outbox
  → 자산별 결과 집계
  → AssetSnapshotProjector 결정적 upsert / Reporting Event 소비
```

배당 처리:

```text
Disclosure Adapter
  → 내부 disclosure 계약
  → source + 안정 공시 ID로 DividendEvent upsert
  → 미지급 정정은 최신 값 원자 교체, 명시 취소는 제거
  → 기준일 적격 수량 고정
  → 지급일 paid 전이
  → Annual Projection 멱등 재구축
```

상세 현재 흐름은 [자산 자동 처리와 배당 종단 흐름](../../system/flows.md#6-자산-자동-처리)을 따른다.

## 8. 제품 결정과 Human in the loop

| 결정 | 소유 기능 | 영향 |
|---|---|---|
| [DEC-011](../../governance/decisions.md#dec-011) | Asset Automation | 신규·기존 자산의 자동화 최초 활성화 월 납입·상환 |
| [DEC-014](../../governance/decisions.md#dec-014) | Dividends/Holdings | 기준일과 가장 가까운 Position snapshot 선택, 동률 시 이전 날짜 우선 |
| [DEC-017](../../governance/decisions.md#dec-017) | Portfolio Core | 일반 사용자 복구를 금지한 자산 논리 삭제, 레거시 비활성 변환, 관리자·운영 복구와 별도 수동 영구 purge |
| [DEC-018](../../governance/decisions.md#dec-018) | Holdings·External Operations | 마지막 성공 시세 무기한 평가와 Firebase 기반 공급자 장애 log·Health·경보 |
| [DEC-035](../../governance/decisions.md#dec-035) | Holdings·External Operations | Cloud Storage 최근 성공 3일치 종목 카탈로그와 5분 인스턴스 메모리 캐시, `stocks.json` fallback 제거 |
| [DEC-043](../../governance/decisions.md#dec-043) | Dividends | 미지급 배당 최신 공시 덮어쓰기·이전 값 미보관, 지급 전 명시 취소 제거, paid 불변 |
| [DEC-046](../../governance/decisions.md#dec-046) | Asset Automation·공통 UoW | 일반 terminal receipt 30일, AutomationExecution은 관련 Asset·가구 수동 영구 purge까지 보존 |
| [DEC-048](../../governance/decisions.md#dec-048) | Holdings·Portfolio·Reporting | Position history 수동 purge 전 보존, 자산 Snapshot 중간 공백은 직전값 유지, 최초 Snapshot 전은 빈 값 |
| [DEC-049](../../governance/decisions.md#dec-049) | Holdings·External Operations | 개별·자산 페이지·23:55 전체 시세 갱신, 전체 종목 수 무제한과 내부 50개 page·병렬 5·10초 timeout·총 3회 시도 |
| [DEC-052](../../governance/decisions.md#dec-052) | Asset Automation·External Operations | 매일 00:00 due 계획 조회, nextDueDate 기반 누락 월 멱등 복구, 과거 execution 불변 |
| [DEC-053](../../governance/decisions.md#dec-053) | Holdings·Portfolio Core | 최신 사용 가능 외화 Quote·환율의 skew 제한 없는 조합과 관측 provenance 보존 |
| [DEC-058](../../governance/decisions.md#dec-058) | Portfolio Core·Reporting | 선택 기간 Snapshot의 type·ownerRef dimension을 현재 자산·프로필 상태와 무관하게 과거 필터에 제공 |
| [DEC-060](../../governance/decisions.md#dec-060) | Holdings·External Operations | Frankfurter v2 단일 환율 공급자, 마지막 성공 환율 무기한 사용, 네이버·보조 공급자 fallback 금지 |
| [DEC-062](../../governance/decisions.md#dec-062) | Dividends·External Operations | 배당 discovery·lifecycle sweep을 매일 09:00~20:00 매시 정각 실행, 시간별 멱등 occurrence |

남은 정책은 [미결정 사항 단일 목록](../../governance/pending-decisions.md)에서 관리합니다. 배당 시간별 schedule은 DEC-062, 환율 공급자·stale 정책은 DEC-060, 과거 자산 dimension은 DEC-058, 외화 Quote·환율 조합은 DEC-053, 자산 자동화의 매일 due 처리·누락 월 복구·과거 execution 불변은 DEC-052, 시세 갱신 시점·호출 한도는 DEC-049, Position history 보존·자산 차트 gap은 DEC-048, 처리·운영 기록 보존은 DEC-046, 배당 lifecycle·정정·취소는 DEC-043, 종목 catalog stale·보존·cache는 DEC-035로 확정했습니다. 결정 전에는 나머지 미확정 범위의 과거 Event를 자동 삭제·재작성하거나 실패를 0·빈 성공·고정 추정값으로 바꾸지 않습니다.

## 9. 테스트 소유권

상세 테스트는 각 기능 문서가 소유한다.

- [Portfolio 테스트](modules/portfolio/requirements.md#8-모듈-테스트-시나리오)
- [Holdings/Market 테스트](modules/holdings-market-data/requirements.md#8-모듈-테스트-시나리오)
- [Asset Automation 테스트](modules/asset-automation/requirements.md#8-모듈-테스트-시나리오)
- [Dividends 테스트](modules/dividends/requirements.md#8-모듈-테스트-시나리오)

Context 경계에서 추가로 묶어 검증한다.

- 같은 자산 자동화 month 재실행 → 잔액 한 번 반영
- Provider 실패 → 기존 Position/Asset 가치 유지
- Provider 장기 실패 → lastQuote·observedAt 유지, 시도별 log와 run별 Health 누적, 즉시·3회 경보 후 성공 복구
- transaction callback 재실행 → 외부 Provider 중복 호출 없음
- 여러 자산 중간 실패 → 성공·실패 범위와 재시도 수렴
- Dividend Event 중복·순서 역전 → 상태와 Projection 수렴
- Asset 논리 삭제·운영 복구 → 일반 사용자 목록·복구 거부, deleted 동안 처리 차단, 운영 복구 후 active 상태·이력 재사용과 삭제 기간 자동화 비소급
- 별도 수동 Asset purge 중 종속 정리 실패 → purging 유지와 checkpoint 재시도, 복구 금지
- paid 배당이 있는 Asset 영구 purge → 기존 DividendEvent와 월·연간 합계 불변
- Scheduler 교체 → 동일 Application Command와 결과, Domain 계산 불변
- Position·Valuation commit 직후 Event 전달 실패 → 강한 상태는 완결되고 downstream만 재시도
- 같은 Snapshot Event 재전달 → `AssetSnapshotProjector` 한 문서로 수렴하고 Scheduler·Reporting 직접 쓰기 없음
- purge 중간 page 실패·재호출 → checkpoint부터 재개하고 다른 Context 데이터는 유지

## 10. 변경 경계 확인

- Naver를 다른 시세 Provider로 바꿔도 Portfolio Domain을 수정하지 않아야 한다.
- Provider 관측 저장소와 경보 채널을 바꿔도 Quote fallback·평가 Policy를 수정하지 않아야 한다.
- 자동 상환 공식을 바꿔도 Holdings와 Dividend를 수정하지 않아야 한다.
- 차트 기간을 바꿔도 Asset Canonical schema를 수정하지 않아야 한다.
- 배당 Projection을 재구축해도 Position을 수정하지 않아야 한다.
