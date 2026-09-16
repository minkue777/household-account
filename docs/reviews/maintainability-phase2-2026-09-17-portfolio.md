# 포트폴리오·외부 운영 2차 유지보수성 검토 — 2026-09-17

분석 기준은 `f1ed5a8`입니다. 1차 검토의 [45개 요구사항 대조와 수정 결과](maintainability-2026-09-16-portfolio.md)를 이어서, 실제 변경이 다른 기능에 미치는 영향과 상태의 소유 위치를 검토했습니다. 최초 집계에서 빠졌던 Reporting 소유 자산 통계 3개를 별도로 추가하여 이 보고서의 coverage는 48개입니다. Reporting 모듈 전체는 지출 6개와 자산 3개로 구성되며 지출 6개는 Finance 보고서가 담당합니다. 이번 문서의 행 번호는 이 작업의 수정 후 파일 기준이며 링크는 저장소 상대 경로입니다. 운영 데이터 조회, commit, push, 배포는 수행하지 않았습니다.

## 결론과 검증 깊이

확정 문제 세 가지를 수정했습니다. 일반 자산 편집이 자동화 상태를 재평가하던 결합, 보유목록 캐시가 사용자 세션보다 오래 살아남던 결합, 예약 평가의 다음 phase가 프로세스 메모리의 실패 목록에 의존하던 결합입니다. 세 경우 모두 실제 호출 경계를 사용하는 회귀 테스트로 보존해야 할 동작을 확인했습니다. 신규 프레임워크, 저장 컬렉션, 이벤트, migration은 추가하지 않았습니다.

요구사항과 진입점의 존재만으로 모든 기능을 심층 검증했다고 판정하지 않습니다. 아래 표의 “집중 검증”은 이번에 실제 adapter/runtime 또는 hook 테스트를 실행한 범위이고, “정적 심층”은 실제 UI/명령/저장/갱신 흐름과 변경 시나리오를 읽었지만 운영·브라우저 E2E를 실행하지 않은 범위입니다. “1차 유지”는 1차 근거를 현재 경로와 대조한 것으로, 이번에 모든 공급자 parser나 모든 UI 조작을 다시 실행했다는 뜻이 아닙니다.

## 확정 발견과 적용한 개선

### P2-A · 일반 편집이 자동화 상태에 영향을 주는 경계

**변경 시나리오.** 적금 이름·메모·아이콘·현재 잔액만 수정하거나, Web 외 호출자가 기존과 같은 납입액·납입일을 다시 보냅니다. 기준선의 `updateAsset`은 매번 Plan을 읽고 동기화했습니다. `syncAutomationPlan`은 설정이 양수이면 `needs-attention`, `suspended`, `recovering-before-stop`도 다시 active로 만들 수 있었습니다. 수정 대상과 무관한 자동화가 transaction 읽기 및 상태 변경 범위에 들어왔습니다.

**실제 경로.** [AssetEditModal](../../web/src/components/assets/AssetEditModal.tsx)의 전체 폼 값 → [assetService](../../web/src/lib/assetService.ts)의 `intendedChanges`/`effectivePatch` → [portfolioCommands](../../web/src/features/portfolio/application/portfolioCommands.ts) → [portfolioHouseholdCommandHandlers](../../functions/src/bootstrap/commands/portfolioHouseholdCommandHandlers.ts) → [portfolioAssetCommandApplication](../../functions/src/contexts/portfolio/core/application/portfolioAssetCommandApplication.ts) L220, L359 → [RuntimeStore](../../functions/src/adapters/firebase/portfolio/firebasePortfolioRuntimeStore.ts)의 단일 transaction → 자산 subscription과 통계 cache invalidation입니다. UI가 전체 폼을 보내더라도 실제 Command에는 변경 필드만 남으므로 metadata 전용 경로는 실사용 경로입니다.

**수정 소유.** Core는 raw patch 파싱, 자산 version/명의자 검증, transaction 조립을 유지합니다. Plan 업무 의미는 [Automation의 설정 정책](../../functions/src/contexts/portfolio/automation/domain/policies/assetAutomationConfiguration.ts) L23, L93, L219로 옮겼습니다. 입력은 [AssetAutomationSubject](../../functions/src/contexts/portfolio/automation/domain/model/assetAutomationConfiguration.ts)의 identity·유형·생성일·설정뿐이며, 정책은 balance·Position·owner·Firestore를 알지 못합니다. Core port의 기존 이름은 type alias로 보존하여 wire/저장 계약 변경을 피했습니다. 상환 방식 정규화와 연월 계산도 Automation의 기존/신규 단일 순수 정책을 사용합니다.

**부작용 격리.** 자동화 관련 필드가 없는 patch는 기존 read scope에 `automationPlans:false`를 전달합니다. 관련 필드가 있어도 정규화 후 유형·설정이 실제로 바뀐 경우에만 검증과 Plan 동기화를 합니다. 관련 필드 목록은 `ASSET_AUTOMATION_FIELDS` 하나를 Command 허용 필드와 read scope 선택이 공유합니다. 실제 설정 수정 시에만 새 revision을 만들며, AUTO-002에 따라 최초 활성화월을 다시 계산하지 않습니다. `needs-attention` 설정을 바로잡아도 미처리 overdue 날짜는 유지합니다.

**보존 근거.** [실제 Firebase RuntimeStore 테스트](../../functions/test/adapters/firebase/portfolio-runtime-store.test.ts) L98–148에서 다음을 확인했습니다.

- active/needs-attention/suspended/recovering-before-stop 각각에서 metadata 편집은 transaction read 4건(receipt, 정규 자산, legacy 자산, 명의자 profile)이며 Position·Holding·Automation 조회와 쓰기는 0건입니다. Plan 전체 문서는 동일하고 자산 version은 한 번 증가합니다. 같은 receipt 재실행은 version을 다시 증가시키지 않습니다.
- 같은 값의 자동화 patch는 needs-attention/suspended/recovering 상태, revision 및 Plan 문서 전체를 보존하며 자동화 쓰기는 0건입니다. 관련 필드가 포함되므로 Plan 읽기까지 0건이라고 주장하지 않습니다.
- 납입액·일자 변경은 revision 2를 만들고 revision 1을 보존합니다. 9월 17일의 needs-attention 수정에서도 8월 10일 overdue와 최초 활성화/적용월은 유지됩니다.
- 기존 중지 테스트는 overdue가 있을 때 기존 납입액과 원래 stop 시각을 보존하여 recovering-before-stop으로 이어지는 것을 검증합니다. 최초 포함월의 잔액 delta 0 execution, 삭제 시 종속 이력 보존, 계좌 version 경합 테스트도 통과했습니다.

이는 단순 파일 이동이 아닙니다. 납입 정책 변경의 소유 위치를 좁히면서 metadata happy path에서 다른 모듈의 조회와 상태 전이를 실제로 제거했습니다. 단, Core의 raw DTO 파서는 API 경계여서 남았습니다.

독립 교차검토에서도 metadata 격리와 저장된 예약 결과 재사용의 새 결함은 발견되지 않았습니다. 자동화 runtime adapter의 상환 방식 정규화 import는 Core의 호환 re-export를 거치지 않고 Automation public을 직접 사용하도록 마무리했습니다. migration 등 기존 호출자를 위한 Core 호환 export는 유지합니다.

### P2-B · 보유목록 cache 수명이 인증 세션과 다릅니다

**변경 시나리오.** 같은 가구의 다른 Member로 전환하거나 로그아웃한 직후 다시 로그인합니다. 기준선 [useHouseholdHoldingSnapshots](../../web/src/lib/utils/useHouseholdHoldingSnapshots.ts)는 householdId별 module Map에 마지막 목록을 보관했습니다. 같은 가구의 새 세션과 이전 세션을 구분하지 않고 공통 reset에도 등록되지 않았습니다. unsubscribe 후 도착하는 이전 callback도 cache를 갱신할 수 있었습니다.

**수정.** 기존 [clientSessionScope](../../web/src/composition/clientSessionScope.ts)와 [reset registry](../../web/src/composition/clientSessionResetRegistry.ts)를 재사용합니다. cache는 활성 actor의 마지막 snapshot 하나만 보관합니다. principal/household/member/sessionGeneration/accessMode와 reset generation, 구독 active 여부를 함께 확인합니다. reset은 cache 폐기와 활성 구독 해제를 하고, dispose는 active를 먼저 false로 만든 뒤 두 listener를 한 번 해제합니다. 두 번째 listener 설치 실패에서도 첫 번째 listener를 해제합니다.

**실제 갱신 경로.** 자산 페이지의 가구 단위 stock/crypto listener → 공용 snapshot hook → 선택 계좌 manager의 필터/평가 → 상세 보유목록입니다. 계좌마다 새 Firestore listener를 늘리지 않고, 같은 인증 세션에서 재방문할 때 마지막 snapshot을 즉시 표시하는 동작은 보존했습니다. 구독을 공유하는 새 전역 서비스는 만들지 않았습니다.

**근거.** [hook 계약 테스트](../../web/src/__tests__/features/portfolio/householdHoldingSnapshots.contract.test.ts)에서 같은 가구 Member 교체, logout reset, 재로그인, remoteReadEpoch 교체, 오래된 callback, 이중 unsubscribe 방지, 일부 구독 설치 실패를 검증했습니다. [manager snapshot 테스트](../../web/src/__tests__/features/portfolio/holdingManagerSnapshot.contract.test.ts)는 계좌별 필터링과 기존 평가 표시를 함께 확인합니다. 두 파일 9건이 통과했습니다. 실제 Firebase 네트워크의 callback 순서를 관측한 것은 아니며 테스트에서 지연 callback을 명시적으로 재현했습니다.

### P2-C · 예약 평가 phase 사이 실패 상태가 메모리에만 있습니다

**재현.** [assetValuationScheduledPages](../../functions/src/operations/scheduling/assetValuationScheduledPages.ts)는 실패 가구를 closure Set에 저장했습니다. [공통 runner](../../functions/src/platform/external-operations/application/scheduledJobExecutionApplication.ts)는 재시작할 때 저장된 non-retryable refresh 결과를 건너뜁니다. 새 pages의 Set은 비어 있으므로 후속 snapshot phase가 실패를 잊습니다. 실제 runner와 Firebase repository를 사용하는 회귀에서 최초 snapshot 호출 0회, 같은 occurrence를 새 pages로 재실행하면 1회가 되어 실패를 확인했습니다.

**최소 수정.** [ScheduledFeaturePagePort](../../functions/src/platform/external-operations/application/ports/out/scheduledJobExecutionPorts.ts)에 선택적인 기존 target 결과 조회 callback을 추가했습니다. runner가 이미 읽어 만든 `byHash`의 `StoredJobTargetResult`를 그대로 반환합니다. DB 읽기, 컬렉션, 저장 상태, target identity를 추가하지 않았습니다. 자산 pages의 Set은 제거했습니다. snapshot은 저장 refresh 결과가 없거나 실패이면 진행하지 않으며, 실패의 retryable 여부를 계승합니다. 기능 phase의 선행 조건은 자산 pages가, lease/checkpoint/retry는 공통 runner가 계속 소유합니다.

**보존과 검증.** [예약 평가 테스트](../../functions/test/operations/scheduling/asset-valuation-scheduled-pages.test.ts) L35에서 terminal 실패 뒤 재실행과 refresh phase 다음 page limit 중단 후 checkpoint 재개를 검증했습니다. refresh 총 1회, snapshot 0회입니다. 기존 정상 가구/실패 가구 부분 재시도에서는 정상 공급자와 성공 snapshot을 반복하지 않고 실패 가구만 복구합니다. 공통 scheduled execution, Firebase lease fencing, incident recovery까지 4파일 26건이 통과했습니다. callback은 메모리 Map lookup만 하므로 happy path의 원격 조회 수는 증가하지 않습니다.

## 기능별 변경 시나리오·소유와 파급

| 기능/변경 시나리오 | 실제 UI·실행 → 명령·저장 → 갱신 | 수정 위치와 의존/중복 판단 | 보존 경계·이번 검증 깊이 |
|---|---|---|---|
| 예금 이름, owner, 잔액, 메모 수정 | AssetEditModal → assetService의 entity queue/유효 patch → Core Asset Command → RuntimeStore → asset subscription/통계 invalidate | UI 입력 표현, Core의 자산 불변식, adapter의 legacy 호환 mapping이 각기 다릅니다. Automation 호출은 P2-A로 분리했습니다. | expectedVersion/receipt/owner 검증/원자 저장 보존. metadata와 같은 값 patch는 집중 검증했습니다. |
| 자산 생성·재정렬·논리 삭제 | AssetAddModal/AssetList → portfolioCommands → Core create/reorder/delete → 동일 writer | 전체 순서 집합 검증은 Core, 저장 차이 계산은 writer입니다. 삭제는 이력 물리 삭제로 확장하지 않습니다. | 기존 runtime 테스트에서 생성 원자성, 삭제 종속 이력, stale version을 검증했습니다. 터치 제스처·운영 purge E2E는 이번 미실행입니다. |
| 주식·코인 수량/평단 변경 | Stock/CryptoHoldingList → manager → assetService → Position Command → revalueAsset → Holdings accountValuation → Position+Asset+history+receipt+outbox commit | 입력 instrument/market 정규화는 아직 Core `portfolioPositionPolicy`에 있습니다. 계산은 Holdings public이 소유합니다. 새 시장 추가는 parser·target route·provider adapter·UI DTO를 함께 봐야 합니다. | transaction을 모듈별로 나누면 잔액 불일치가 생깁니다. 변경 없는 계산을 옮기기만 하는 추가 리팩토링은 하지 않았습니다. runtime/valuation 집중 회귀, UI 흐름은 정적 심층입니다. |
| 시세 공급자 변경/부분 실패 | 수동 새로고침 또는 예약 pages → Core MarketRefresh → provider quote → version 재검사 후 원자 commit → asset subscription | 공통 HTTP가 네트워크 제한/재시도를, market adapter가 공급자 의미를, Core가 재평가 intent와 lease를 소유합니다. 동일 시장/코드 조회를 묶고 실패 시 last-good를 보존합니다. | 50개 page/5 worker/총 3회, partial receipt, version conflict 보존. 이번 공급자 실통신은 없고 1차 parser 수정 결과를 유지했습니다. |
| 적금 납입일·금액/대출 방식 변경 | AssetEditModal → Core parse → Automation 설정/Plan 정책 → 기존 RuntimeStore writer → 일일 due runtime | P2-A로 Plan 의미의 소유를 Automation에 모았습니다. Core 전체 상태 대신 좁은 Subject와 Plan 목록만 전달합니다. due 실행/원금 계산은 기존 Automation 경로입니다. | 최초월·과거 revision·월 execution·overdue·중지 의미를 집중 검증했습니다. 실제 은행 이체 기능은 범위에 없습니다. |
| 자산별 상세 화면 재방문/사용자 교체 | assets page → 가구 보유 snapshot → manager가 계좌 필터 → 목록 | P2-B의 단일 활성 actor cache입니다. 상세 열기마다 계좌별 query를 새로 만들지 않습니다. | 9건 hook/manager 집중 검증. React 재렌더·reset·늦은 callback을 fixture로 재현했습니다. |
| 통계 기간/명의자/자산유형 표시 변경 | assets/stats page → assetStatisticsReadModel → canonical AssetSnapshot 페이지 → chart carry-forward/오늘 live 값 | cache는 이미 actor key, TTL 30초, 최대 8항목, pending promise, generation을 갖습니다. read model은 오늘까지 읽은 이력을 기간 버튼에서 재사용하고, 삭제된 과거 dimension도 유지합니다. | 서버 관측 목록만 오늘 합계를 대체하고 읽기 실패를 0원으로 보정하지 않는 경계를 읽었습니다. 이번 차트 렌더/E2E는 미실행인 정적 심층입니다. |
| 오늘 일일평가 중단 후 재개 | asset-valuation job → refresh phase → snapshot phase → canonical snapshot → Web 통계 | P2-C로 이전 phase 결과는 저장된 target의 단일 사실을 사용합니다. snapshot은 여전히 별도 transaction/phase입니다. | 실제 runner+Firebase repository 재개 집중 검증. 프로세스 강제 종료/실제 Scheduler 운영 실험은 미실행입니다. |
| 보유종목 삭제 후 기존 배당 정정/지급 | weekday job → discovery와 기존 이벤트 lifecycle → 공통 applyAnnouncement → event repository → annual projection → Web 조회 | 1차에서 persisted identity recheck와 correction 단계를 공유했습니다. occurrence cache는 discovery/recheck 응답을 재사용합니다. paid 불변·version 확인은 저장 경계에 남습니다. | 기존 source 소멸 뒤 진행, NoData 보존, attempts 0 health 제외의 1차 검증을 유지했습니다. 2차는 actual runtime/repository 재확인이고 KIND의 실제 취소 wire는 확인하지 않았습니다. |
| 연간 배당 합계 표시 방식 변경 | AssetDividendChart → assetDividendReadModel → holdings+연간 snapshot+events 병렬 조회 → eventId 기준 예상/확정 분리 | Web 조합은 검증된 동일 actor로만 완료됩니다. 연간 projection은 전체 canonical event를 가구/연도별 다시 합산하는 구현입니다. 작은 가구에 새 incremental inbox를 추가할 이유는 확인되지 않았습니다. | events map과 12개월 합계를 같은 projection으로 씁니다. 전체 이력 증가 시 비용, 동시 job 재구축의 운영 성능은 측정하지 않았습니다. |
| Billing 계산 기준 변경 | billing-cost scheduled page → GoogleCloudBillingCostReader → billingCostSummary 순수 계산 → 단일 성공 snapshot → Admin overview | source SQL/인증/최대 bytes는 adapter, 최근 7완료일 평균·월말 추정은 순수 policy, 표시 fallback은 Admin입니다. 조회 화면에서 BigQuery를 호출하지 않습니다. | project 필터, cost+credits, 0일 포함 평균, 실패 시 기존 snapshot 보존을 정적으로 확인했습니다. 실제 청구액/BigQuery/관리자 UI는 미조회입니다. |
| 외부 장애 재시도·운영 경보 변경 | trackedScheduledJob → execution application → feature pages → repository; 독립 monitor → 운영 관측 | 기능별 target 의미와 공통 lease/checkpoint/monitor가 분리됩니다. P2-C callback은 이미 저장된 결과만 공유하며 feature 정책을 runner로 옮기지 않습니다. | lease fencing/기존 retry/incident 회귀를 실행했습니다. 실제 absence 경보 배포·전달은 확인하지 않았습니다. |

## RuntimeStore와 복잡성의 판단

[RuntimeStore port](../../functions/src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort.ts)는 Asset, Position, owner reference, Automation Plan을 담은 복합 상태와 원자 변경 함수를 제공합니다. 넓은 shape 자체를 결함으로 보지 않았습니다. [loader](../../functions/src/adapters/firebase/portfolio/firebasePortfolioRuntimeStateLoader.ts)는 자산 단위 scope, Position 생략, Plan 생략을 지원하고, [writer](../../functions/src/adapters/firebase/portfolio/firebasePortfolioRuntimeMutationWriter.ts)는 전후 차이가 있는 문서만 저장합니다. Position 변경과 계좌 잔액, receipt와 outbox의 단일 commit은 기능 계약상 필요합니다. 이번 문제는 port의 필드 수보다 호출자가 scope와 정책 호출 조건을 충분히 좁히지 않은 것이었습니다.

명의자 profile 조회는 자산 owner 정규화에 사용되므로 metadata 편집에서도 유지합니다. canonical/legacy 이중 읽기·쓰기는 현재 이관 호환 계약에 연결되어 있습니다. 이를 제거하려면 실제 클라이언트/운영 도구의 의존과 migration 완료 증거가 필요하며, 3인 가구라는 이유만으로 삭제할 수 없습니다.

[assetService](../../web/src/lib/assetService.ts)의 queue·authoritative base·effective patch·optimistic rollback은 동시에 다른 필드를 수정했을 때 손실을 막는 실제 사용 경로입니다. 파일이 크다는 이유로 generic repository/hook를 추가하지 않았습니다. 반면 보유 cache의 가구별 Map은 현재 활성 사용자 하나에 필요한 범위를 넘었고 reset 책임도 빠져 있어 하나의 세션 snapshot으로 줄였습니다.

배당의 announced→fixed→paid, 정정 시 적격 수량 재산정, paid 불변, NoData/실패와 취소 구분은 요구사항에서 발생하는 복잡성입니다. 이력 없는 경우를 0으로 처리하거나 최신 Holding만 읽도록 단순화하면 이 계약을 잃습니다. 전체 연간 rebuild는 구현과 재시도 이해가 단순하므로 측정 없이 incremental projector로 바꾸지 않았습니다.

## Reporting 자산 통계 3개 추가 검토

기존 검토는 자산 통계 read model과 페이지의 actor/cache/오늘 관측 경계를 읽었지만, Reporting 소유 ID를 연결하지 않았고 페이지·변동 차트의 중복 계산 소유까지 전부 대조한 상태는 아니었습니다. 이 누락을 보완하기 위해 [Reporting 요구사항](../requirements/supporting-platform/modules/reporting/requirements.md), [설계](../requirements/supporting-platform/modules/reporting/design.md), 아래 실제 Web 페이지·차트·cache와 관련 테스트의 기대값을 추가로 읽었습니다. 이 보완에서는 제품 코드 변경이나 테스트 재실행 없이 정적으로 검토했습니다.

| ID·변경 시나리오 | 실제 경계·수정 소유 | 비용·부작용·보존 판단 |
|---|---|---|
| STAT-AST-001 · 기간 preset 또는 금융자산 표시 조건 변경 | [statisticsPeriod](../../web/src/features/reporting/statisticsPeriod.ts) L17이 서울 월 경계와 ALL의 `undefined` 시작일을 소유합니다. [통계 페이지](../../web/src/app/assets/stats/page.tsx) L161은 기본 3M, L247 이후는 금융자산의 property/loan 제외, L646 이후는 기간 버튼을 소유합니다. | 현재 ALL에는 2020 cutoff가 없습니다. 페이지가 `readAssetStatisticsHistory(undefined, endDate)`를 한 번 읽고 기간 버튼은 메모리 필터만 바꾸므로 배당/변동 차트까지 재조회하지 않습니다. preset 수정은 순수 기간 policy와 버튼의 대응을 함께 검증하면 되고 Portfolio 저장/Command 변경은 필요하지 않습니다. |
| STAT-AST-002 · 시작 baseline, gap, 오늘 실시간 변화량 규칙 변경 | [read model](../../web/src/platform/reporting/assetStatisticsReadModel.ts) L8은 baseline+window Query도 제공하지만, 현재 주 페이지는 전체 이력을 재사용해 L254의 `history` 계산에서 dimension별 시작 이전 마지막 값을 기준일로 옮깁니다. L89의 `buildCarriedSeries`는 `undefined`와 0을 구분합니다. [AssetProfitChart](../../web/src/components/assets/AssetProfitChart.tsx) L41–90은 전달된 `sourceHistory`에서 일별/월별 변화량을 만들고 자체 요청을 생략합니다. | 전체 이력을 읽는 첫 진입 비용은 최근 3개월 데이터량에만 비례하지 않습니다. 1가구 1일 1 snapshot, 5,000개 page·총 50,000개 안전 한도·30초 cache라는 현재 규모에서는 기간 전환을 위해 별도 서버 집계나 이중 cache를 추가할 근거가 없습니다. 상한/중간 실패를 부분 성공으로 반환하지 않는 경계는 유지해야 합니다. 실패 UI, 미관측 빈값, 관측 0원과 오늘 서버 관측을 구분합니다. |
| STAT-AST-003 · 과거 dimension 이름/보관 상태 변경 | read model L28–37은 snapshot의 `TYPE_*`, `OWNER_REF_*`, `ownerDisplayNames`를 보존하며 현재 active profile을 조회하지 않습니다. 페이지의 L254–269와 `TrendSeriesKey` L51은 유형만 차트에 연결하고 명의자 control은 제공하지 않습니다. 유형 선택의 유효성은 `availableTypes`와 L341의 effect에서 관리합니다. | **명의자 UI 생략은 이전 사용자의 “자산통계에서 소유자 선택을 삭제” 지시에 따른 현재 의도입니다.** owner 원천 보존과 명의자 UI 제공을 동일한 완료 판정으로 묶지 않습니다. Reporting 문서의 목표 owner 필터 표현과 현재 사용자 선택을 구분하며, 이 검토를 근거로 UI를 복원하지 않습니다. 과거 데이터·표시명 보존은 계속 필요하고 문서의 요구사항 전체 재정의는 이번 범위 밖입니다. |

조회와 화면 상태의 소유는 [assetStatisticsQueryCache](../../web/src/platform/reporting/assetStatisticsQueryCache.ts)가 actor/sessionGeneration/accessMode, query+remote epoch, 최대 8항목/30초, pending promise 공유와 generation 폐기를 담당하고, 페이지가 현재 sourceKey·revision과 effect cleanup을 담당하는 구조입니다. Portfolio Command 성공은 별도 invalidation으로 연결됩니다. 기간·유형·금융자산 토글은 서버 쓰기/시장 갱신을 호출하지 않으며, 오래된 actor 응답이나 무효화된 cache entry가 최신 화면을 갱신하지 못하게 하는 경계를 확인했습니다.

유지보수 관점에서 남는 작은 중복은 “오늘 live point와 이전 잔액에서 changeAmount 만들기”입니다. 페이지의 `upsertRealtimeSnapshot` L114와 AssetProfitChart L61–69에 같은 의미가 있습니다. 현재 계산은 둘 다 `previous?.balance ?? (today.balance - today.changeAmount)`를 사용하므로 확정 불일치로 판정하지 않습니다. 향후 오늘 기준값 규칙을 바꾼다면 두 곳을 함께 바꿔야 하며, 그 변경 시 하나의 순수 display-point helper로 모으는 것이 충분합니다. 새 Query/Controller/Repository 계층을 만들 필요는 없습니다. trend의 gap carry와 profit의 “관측 없는 날 변동은 NoData”는 서로 다른 표시 계약이므로 단순 중복으로 합치지 않습니다.

관련 근거 테스트는 [assetStatsSessionRead](../../web/src/__tests__/features/portfolio/assetStatsSessionRead.contract.test.tsx) L108의 명의자 control 미표시·관측 0원·2019년 ALL, L129의 기간 전환 시 조회 수 불변, [assetStatisticsReadModel](../../web/src/__tests__/features/portfolio/assetStatisticsReadModel.contract.test.ts) L76의 0원 baseline·archived owner 원천 보존, [assetProfitSource](../../web/src/__tests__/features/portfolio/assetProfitSource.test.tsx) L45의 shared history로 조작 시 추가 조회 없음입니다. 실제 Chart.js 시각 렌더·모바일 tooltip·운영 장기 이력 비용은 이번에 실행/측정하지 않았습니다. 특히 목표 서버 Query/Controller의 fixture가 실제 Web 차트 전체를 검증한다고 주장하지 않습니다.

## 요구사항 coverage

Portfolio·External 소유 ID 45개와 Reporting 소유 자산 통계 3개, 총 48개를 아래에 한 번씩 기록했습니다. 판정은 기능 완성 인증이 아니라 이번 유지보수 검토의 깊이입니다. 대표 경로의 축약명은 위 실제 흐름 표와 연결됩니다.

| 소유 ID | 실제 검토 대표 경로 | 2차 판정·변경 영향 |
|---|---|---|
| AST-001 | AssetEditModal → assetService → portfolioAssetCommandApplication | 집중 검증. P2-A 일반 편집의 자동화 영향 제거. UI 숫자 입력 보정은 이번 변경 제외입니다. |
| AST-002 | portfolioTotals, assetMath, runtime valuation | 정적 심층/기존 runtime 회귀. signed loan·금융합계 정책 유지. |
| AST-003 | AssetList → reorderAssets → RuntimeStore writer | 기존 runtime 회귀. 전체 순서/version 원자성 유지; gesture는 1차 유지. |
| AST-004 | assetStatisticsReadModel → canonical assetSnapshots | 정적 심층. 과거 owner/type dimension을 현재 목록으로 지우지 않음. |
| AST-005 | assets/stats/page, asset history carry-forward | 정적 심층. 오늘 서버 관측과 과거 이력 fallback 확인; 렌더 미실행. |
| AST-006 | deleteAsset, firebaseAssetLifecycleUnitOfWork | 삭제 보존 집중 회귀. 운영 복구와 단독 영구 purge 전체는 1차 제한 유지. |
| AST-007 | portfolio command registry, assets/page | 1차 유지. production demo surface 추가 없음. |
| AST-008 | assetSnapshotProjectionApplication, FirebaseAssetSnapshotProjection | 정적 심층. 자산 전용 scope/날짜 upsert와 P2-C phase gate. |
| AST-009 | asset owner/profile normalization, dailyAssetChangeSummary | owner 읽기 필요성 정적 심층. UI 명의자 동작 전체는 1차 유지. |
| HOLD-001 | portfolioPositionPolicy/Command, useStockHoldingManager | runtime 집중 회귀, parser 소유 결합은 보류. 미제공 필드/legacy 수동 종목 보존. |
| HOLD-002 | useCryptoHoldingManager, accountValuation | 기존 valuation 집중 회귀. 최종 반올림·유효 0원 보존. |
| HOLD-003 | portfolioRuntimeValuation → Holdings accountValuation | 정적 심층 및 valuation 회귀. 사용자/예약 공통 계산 유지. |
| HOLD-004 | FirebasePortfolioRuntimeStore/MutationWriter | 집중 검증. Position+Asset+receipt/outbox 원자 경계 유지. |
| HOLD-005 | useHouseholdHoldingSnapshots → holding managers | 집중 검증. P2-B actor/reset/늦은 callback 격리. |
| FUND-001 | portfolioPositionPolicy, market target, accountValuation | 1차 유지 및 parser 정적 대조. NAV/1000 scale·펀드 route 유지. |
| GOLD-001 | useGoldHolding, market adapter, MarketRefresh | 1차 유지. 실물 3.75/현물 1/ETF 별도 의미 유지. |
| GOLD-002 | FirebasePortfolioMarketData numeric parser | 1차 유지. placeholder 실패/유효 0 구분을 다시 복제하지 않음. |
| MARKET-001 | portfolioMarketHouseholdQueryHandlers → market adapter | 정적 심층. 인증 Query/공급자 의미/공통 HTTP 책임 구분. |
| MARKET-002 | portfolioPositionPolicy/MarketRefreshPolicy | 정적 심층. 명시 market이 route를 결정. |
| MARKET-003 | localStockInstrumentCatalog, instrument search | 1차 유지. 기기 주식 catalog/서버 코인 Query 분리. |
| MARKET-004 | MarketRefresh, provider health store | 기존 runtime 회귀. 실패 last-good/health 의미 유지; 실경보 미검증. |
| MARKET-005 | instrumentCatalogApplication, FirebaseInstrumentCatalog | 1차 유지. publication/last-good/실행 범위 구분; 운영 snapshot 미조회. |
| MARKET-006 | quote observation store, FirebasePortfolioMarketData | 1차 유지. 독립 환율 provenance/마지막 성공값과 USD quote 유지. |
| JOB-AST-001 | assetValuationScheduledPages, MarketRefresh | 집중 검증. P2-C 재시작에서 실패 평가 뒤 snapshot 차단. |
| JOB-AST-002 | assetDailyChangeReadModel, dailyAssetChangeSummary | 정적 대조. 전일 1건/필터별 합계 준비 유지; UI 전환은 미실행. |
| JOB-AST-003 | RuntimeStore version 검증, snapshot phase | 집중 검증. 여전히 별도 phase이며 동일 transaction으로 오해하면 안 됨. |
| AUTO-001 | effectivePaymentDate, AssetAutomationRuntimeStore | 자동화 집중 회귀. 월말/due/execution 멱등 유지. |
| AUTO-002 | Automation assetAutomationConfiguration/firstAutomationMonth | 집중 검증. 최초 적용월을 설정 변경 때 재계산하지 않음. |
| LOAN-001 | loanPrincipalPayment, assetMath preview | 기존 자동화 policy 회귀. 원금 상한·0 하한 유지; preview 렌더 미실행. |
| LOAN-002 | Automation validation, loanPrincipalPayment, runtime store | 집중 회귀. 지원 방식/금리/납입액 검증 유지. |
| AUTO-003 | assetAutomationScheduledApplication, Automation configuration | 집중 검증. metadata/동일값 patch의 needs-attention·stop 보존. |
| DIV-001 | rebuildAllAnnualProjections, assetDividendReadModel | 정적 심층. 12개월/eventId 합계와 동일 actor 조회. |
| DIV-002 | AssetDividendChart, assetDividendReadModel | 정적 심층. 현재 보유 예상과 확정 eventId 구분; chart E2E 미실행. |
| DIV-003 | DividendScheduledRuntime, EventRuntimeRepository | 정적 심층. persisted identity/version/paid 불변의 1차 검증 유지. |
| DIV-004 | EventRuntimeRepository annual rebuild | 정적 심층. 단일 writer/full rebuild 유지, incremental inbox 구현이라고 주장하지 않음. |
| DIV-005 | dividendEligibilityPolicy, dividend holding history | 1차 유지. nearest snapshot 및 sourceVersion 동률 제한은 별도 확인 대상. |
| DIV-006 | lifecycle recheck → applyAnnouncement → repository | 정적 심층. source 소멸/NoData/정정 경계 확인; 실제 취소 wire 미확정. |
| JOB-DIV-001 | dividendScheduledPages, Kind source occurrence cache | 정적 심층. 실행 공유 cache/순차 HTTP/finalize 소유 확인; 실공시 미조회. |
| JOB-DIV-002 | FirebaseDividendHoldingQuery | 1차 유지. KRX ETF 명시 분류와 기존 lifecycle 독립 유지. |
| JOB-ERR-001 | trackedScheduledJob → ScheduledJobExecutionApplication | 집중 검증. P2-C stored outcome 재사용; lease/retry 기존 계약 통과. |
| JOB-ERR-002 | ScheduledJobMonitorApplication, incident repository | incident 회귀 실행. 운영 absence alarm·알림 전달은 미검증. |
| EXT-001 | safeExternalTextHttpApplication, provider parsers | 정적 대조/1차 유지. 네트워크 분류와 공급자 의미의 소유 유지. |
| EXT-002 | household Query auth/quota, PortfolioRefreshLease | portfolio 경계 정적 대조 및 기존 refresh 회귀. 전체 Access 보안은 상위 담당. |
| EXT-003 | safeExternalTextHttpApplication, Node transport | 1차 유지. HTTPS allowlist/redirect/timeout/byte 제한 보존. |
| EXT-004 | GoogleCloudBillingCostReader → billingCostSummary → summary store | 정적 심층. 단일 성공 snapshot/실패 보존. 실제 BigQuery·청구액은 미검증. |
| STAT-AST-001 | statisticsPeriod → assets/stats/page → AssetProfitChart | 추가 정적 심층. 기본 3M/서울 월 경계/ALL cutoff 제거와 금융자산 토글 소유, 전체 이력 재사용 비용 대조. |
| STAT-AST-002 | assetStatisticsReadModel/cache → page baseline/carry → profit shared history | 추가 정적 심층. 관측 0원·NoData·failure 구분과 같은 source 재사용. today display-point 계산은 두 곳에 남아 변경 시 함께 검증 필요. |
| STAT-AST-003 | read model OWNER_REF 보존 → page 유형 control | 추가 정적 심층/의도적 UI 제외. 이전 사용자 지시로 owner 선택 UI는 생략하며 owner 과거 원천은 보존. 문서 목표 owner 필터와 현 UI를 분리 판정. |

## 검증 결과와 남은 실행 계획

| 실행 범위 | 결과 | 확인한 핵심 |
|---|---|---|
| Functions: portfolio-runtime-store, state-load-concurrency, asset-automation-date-policy, asset-automation-scheduled-runtime, portfolio-runtime-valuation | 5파일 46건 통과 | 실제 transaction 호출 수/같은 값 patch/최초월·overdue/평가·동시성 보존 |
| Web: householdHoldingSnapshots, holdingManagerSnapshot | 2파일 9건 통과 | actor/세션/reset/remote epoch/늦은 callback/재방문 cache |
| Functions: asset-valuation-scheduled-pages, scheduled-job-execution, scheduled-job-lease-fencing, scheduled-job-incident-recovery | 4파일 26건 통과 | phase 재시작 재현 후 회귀, retry·lease·incident 보존 |
| Functions `npm run test:types` | 통과 | 공통 callback과 신규 Automation 경계/테스트 타입 |

예약 phase 테스트는 수정 전 예상 0회에 실제 snapshot 1회로 실패했고, 수정 후 통과했습니다. Windows sandbox의 초기 Vitest 실행은 `spawn EPERM`으로 시작하지 못했으며, 허용된 로컬 집중 테스트를 실행하여 위 결과를 얻었습니다. 전체 빌드, architecture, 브라우저/E2E, emulator, 운영 배포 검증은 상위 작업에서 통합합니다.

다음 변경은 이번 독립 개선과 분리합니다.

1. **Holdings 입력 의미의 Core 잔류:** 새 instrument/market 계약 변경이 실제 요청되면 `portfolioPositionPolicy`, `portfolioMarketRefreshPolicy`, Holdings model 및 Web DTO를 함께 검토합니다. 현재 입력 모델을 옮기는 것만으로 별도 transaction이나 repository를 만들지 않습니다. 필요한 회귀는 실제 create/update Position에서 시장·수동/현금·미제공 필드·0원·scale·version fixture입니다.
2. **legacy 이중 저장:** 이관 완료와 구 클라이언트·운영 CLI 사용 여부를 확인한 뒤 loader/writer에서 일괄 축소할 수 있습니다. 현재 단계에서 삭제하면 호환성을 잃을 수 있으므로 유지했습니다.
3. **배당 연간 전체 재구축:** 과거 event 증가에 따른 read/write 비용을 측정하기 전에는 incremental inbox로 바꾸지 않습니다. 측정이 필요하면 annual rebuild 호출 수·event 수·실행시간부터 확인하고, event/projection 일관성을 실제 repository fixture로 고정합니다.
4. **공급자 공시 wire:** 실제 KIND 취소 표지와 별도 정정 문서가 원 공시를 가리키는 규약은 확인되지 않았습니다. `NoData`를 취소로 해석하거나 URL/ID를 추정해 보완하지 않았습니다. 별도 공개 fixture/공급자 규약 확인이 필요합니다.
5. **명세의 목표 계층과 실제 구조:** 자동화 설계에는 participant/UoW의 목표 표현이, Snapshot 명세에는 동일 transaction 표현이 남아 있습니다. 현재 production은 좁은 순수 정책+RuntimeStore와 refresh/snapshot 별도 phase입니다. 문서 전체 재설계는 상위 통합 작업에서 다루며, 이 보고서가 현재 수정 소유와 실제 보존 경계를 명시합니다.
