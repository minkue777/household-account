# 접근·플랫폼 계약별 검토

기준 SHA: `676731d9abda95439afc2dfd827690029d89e048`. 실행 파일 전체를 집계하며 테스트·문서는 별도다. [고정 범위](scope.json)의 19개 모듈 중 이 문서는 가구 접근, Android Host의 일반 세션/시작 경계, PWA, 홈 설정, 외부 작업, 배포, Reporting과 Web 원장 편집을 담당한다. QuickEdit는 [수집·알림 검토](capture-notifications.md)에 함께 연결한다.

## 근거 사용 범위

[직전 전수 감사](../simplicity-2026-10-05/completion.md)의 계약별 실제 실행·검증 근거를 재사용하고, 현재 호출자와 새 중복 후보를 확인했다. `df7ae238..676731d9`의 Access·Android main·플랫폼 서버·배포 도구·Web 접근/홈 코드는 변경되지 않았고, Web Reporting만 이전 두 차례의 통계 단순화로 변경됐다. 따라서 같은 수천 개 파일을 이번에 모두 새로 읽거나 모든 목표 기능을 구현했다고 주장하지 않는다. 목표 명세와 현재 제공 기능을 구분한다.

## Web 원장 편집: 변경

- 입력: 부모가 선택한 `Expense` snapshot과 해당 선택의 `editorKey`. 결과: 허용 patch 또는 삭제 명령, 즉시 낙관적 목록 표시. 실패: 원복·안내 확인 뒤 같은 초안 복구. 저장: 해당 원장 Command 소유, 편집창은 직접 저장하지 않는다.
- ExpenseDetail·SearchModal·IncomeSummaryModal·StatsPage 네 호출자가 모두 새 선택마다 키를 바꾸고 조건부 mount한다. 모달 내부의 expense/isOpen 변경 effect가 수행하던 두 번째 전체 초기화를 제거했다. 초기 원본과 태그는 state initializer가 한 번 소유한다.
- 수정과 삭제의 중복 pending/try/catch/finally를 같은 `runMutation`으로 합쳤다. 삭제 확인은 삭제 호출자가 담당하며, 알림·분할의 서로 다른 종료 시점은 그대로 유지한다.
- 보존: expectedVersion 원본, 중복 제출 방지, 오류 확인까지 초안 숨김, 실패 후 재시도, 이전 인스턴스 늦은 응답의 새 창 무간섭. `useExpenseEditor`를 실제 사용하는 재선택 검사를 추가했다.
- 관련 Jest 5파일 38개 통과. 실제 보류 요청·버전 충돌 브라우저 검증은 최종 통합 기록에서 추적한다.

## 가구 접근: 계약별 유지

실행 진입점은 `accessHouseholdCommandHandlers`, `accessHouseholdQueryHandlers`, 관리자 handler와 `access-operations.mjs`다. [접근 명령 정비](../../operations/access-command-simplicity-2026-10-05.md), [실제 SDK 경계](../../operations/access-test-boundaries-2026-10-05.md), [생명주기](../../operations/lifecycle-simplicity-2026-10-05.md)의 확인 결과와 현재 구현을 대조했다.

| 계약 | 현재 실행 소유자와 유지 이유 |
|---|---|
| ResolveSignedInUser | `firebaseSignedInUserResolver`: 조회 view뿐 아니라 canonical membership/member/household를 확인한다. 빠른 projection만 믿도록 줄이면 삭제된 구성원 접근을 허용한다. |
| ClaimLegacyMembership | `legacyMembershipApplication` + Firebase store: 정확한 legacy 후보·사용자 확인·UID claim 원자 선점은 구버전 전환 계약이다. |
| CreateHouseholdWithSelf | `googleOnboardingApplication`: 생성 receipt와 identity 저장, 별도 finalizeInitialization은 외부 초기화 재시도에 필요한 두 단계다. 호출 횟수로 단계 추정하던 상태는 이미 제거됐다. |
| CreateInvitationCode | 같은 onboarding 함수의 코드 최초 응답·5분 만료·hash 저장. 초대 원문을 receipt에 남기지 않는다. |
| JoinHouseholdAsSelf | 초대 1회 소비와 UID 유일 claim을 같은 transaction에서 확정해야 하므로 단순 CRUD로 합치지 않는다. |
| LogoutHouseholdSession | Web/Native endpoint 해제와 actor-scoped cache·queue purge를 실제 세션 소유자가 수행한다. 일반 서버 로그아웃 모형은 이미 제거됐다. |
| RenameSelf | `memberRenameApplication` + 대상/이름 충돌 조회. 공통 가구 문서 경합과 atomic projection 저장은 동시 이름 선점 방지에 필요하다. |
| CreateAssetOwnerProfile | 로그인 권한 없는 dependent를 만드는 별도 계약이다. 가짜 Member와 합치지 않는다. |
| RenameAssetOwnerProfile | stable profileId·expectedVersion과 과거 참조 보존을 유지한다. 불필요한 전체 members 조회는 이미 없다. |
| ArchiveAssetOwnerProfile | 관리자 권한 + 논리 보관만 수행하며 기존 자산·과거 snapshot을 삭제하지 않는다. |
| ListAssetOwnerProfiles | active/includeArchived는 현재 선택 목록과 과거 이름 해석의 서로 다른 요청이다. |
| RemoveHouseholdMember | 대상 member/membership/profile/claim과 receipt만 읽는 현재 범위를 유지한다. UID claim 해제·즉시 차단은 원자적이다. |
| RestoreRemovedHouseholdMember | 같은 ID 복구와 타 가구 UID 선점 충돌을 검사한다. remove의 반대 쓰기를 무조건 실행할 수 없다. |
| DeleteHousehold | admin console이 논리 삭제와 접근 projection 차단을 소유한다. 실제 자료 purge와 합치지 않는다. |
| RestoreDeletedHousehold | lifecycle application은 실제 복구만 제공한다. 미사용 삭제/purge/authorize 모형은 이미 제거됐다. |
| RequestPermanentHouseholdPurge | 명시적인 운영 요청·확인과 process 생성. 자동 삭제를 추가하거나 실행하지 않았다. |
| RunHouseholdPurgeProcess | bounded claim page·Context checkpoint·finalization의 version/fencing은 중단 후 재개와 새 claim 보존에 필요하다. |
| RepairLegacyMembershipClaim | 운영자 범위/정확한 UID·대상·감사·원자 교정이 필요하다. 업무 로그인에 일반 fallback으로 넣지 않는다. |
| AuthorizeHouseholdAction | 실제 principal/capability/household 경계가 소유하며 정적 허용 모형은 이미 제거됐다. |
| RecordAppVisit | durable visit receipt + stats 단일 transaction, 30일 map 교체. 메모리 최근 ID 목록으로 대체하면 재전송 집계가 달라진다. |
| GetAdminOperationsDashboard | 관리자 전용 복수 source와 unavailable/partial 구분. mixed createdAt의 offset 정렬은 자료 이관 없이는 단일 indexed query와 동치가 아니다. |

## 홈 설정: 변경 및 유지

- ResolveHomeCardConfiguration / `home.update-summary-preferences.v1`: 명령의 Web 카드 키 표와 저장소의 legacy 해석 표를 `homeSummary` 단일 정의로 합쳤다. canonical 타입 판정도 이미 있는 `isHomeCardType`을 사용한다. 명령은 Web 키만 받으며 canonical 저장값도 읽는 adapter와의 입력 차이는 유지한다.
- 교차 검토에서 기존 객체 키 조회가 `toString`·`constructor`·`__proto__`도 허용하는 문제를 확인했다. 세 입력 모두 변경 전 성공으로 오인해 회귀 검사가 실패했다. 정해진 키만 갖는 `ReadonlyMap`으로 원천 정의를 바꾸어 추가 예외 분기 없이 거부한다. 변경 후 3개 모두 typed 거부·설정/receipt/Outbox 무변경을 확인했으며 실제 callable도 브라우저 검사에 추가했다.
- SelectHomeLocalCurrency / ListAvailableLocalCurrencies / `home.select-local-currency.v1`: canonical·legacy 유형 수집의 같은 반복을 한 루프로 합쳤다. 선택된 유형 유지·유형 미상 제외·최초 단일 유형만 자동 선택·expectedVersion·receipt replay·Outbox 원자성을 보존한다.
- BuildHomeSummary: 실제 `BalanceCards`의 원천 조합을 유지한다. 소비자 없는 서버 `HomeCardSourceState` 선언만 제거했다. 오류·미조회·0원 표시를 하나로 취급하지 않는다.
- LoadThemePreference / SetThemePreference / ApplyTheme: 실제 ThemeContext의 SSR default→client 복원, DOM 적용 성공 후 기기 저장을 유지한다. 테마마다 다른 정적 디자인 값을 감축 목적으로 압축하지 않는다.
- 현재 운영에 연결되지 않은 홈 카드 편집 UI 목표는 구현 완료로 표기하지 않는다. 서버 저장 계약과 기존 설정 읽기는 유지한다.
- 관련 서버 3파일 9개 통과. 실제 SDK·브라우저 결과는 최종 기록에서 별도 추적한다.

## Android Host·PWA: 유지

| 계약 | 실제 경계와 결정 |
|---|---|
| Native 로그인·custom token 전달 | NativeAuthCoordinator와 Web bridge의 UID 대조·서버 권위 membership·구버전 응답 fallback을 유지한다. Google 자격의 authorized→전체 계정 fallback은 별도 실패 의미가 있어 작은 catch 절감만을 위해 바꾸지 않았다. |
| SessionMirror 교체·logout | Mutex + encrypted transition journal + generation은 purge 도중 재시작 때 타 사용자 자료가 복원되지 않도록 한다. 메모리 상태 하나로 줄일 수 없다. |
| WebView host/외부 이동 | MainActivity와 TrustedWebOrigin의 정확한 origin·main frame 검증, 외부 브라우저 이동, renderer 복귀를 유지한다. |
| 앱 최초 시작·복귀·계측 | 첫 onResume 중복 방지와 일회 startup gate는 각각 다른 lifecycle 입력이다. 지연 outbox 복구와 lazy Native Auth는 첫 홈 필수 경로에서 제외된 상태를 유지한다. 기존 2초 initial-read 기준을 바꾸지 않는다. |
| versioned bridge·앱 버전·QuickEdit 설정 | requestId별 pending/timeout과 응답 계약 검증은 실제 비동기 RPC 경계다. 민감 호출 scope 확인을 제거하지 않는다. |
| QuickEdit 입력·저장·FIFO·feedback | 별도 수집·알림 검토에서 확인한다. queue 접수와 서버 성공을 합치지 않는다. |
| PWA 설치·페이지·cache | `browserServiceWorker`와 실제 단일 `/sw.js` 경로를 유지한다. runtime 금융 응답과 immutable static cache의 분리는 세션 격리에 필요하다. |
| PWA 갱신·미저장 입력 | PwaRuntimeUpdate의 dirty 입력·사용자 동의·요청한 waiting worker만 reload는 강제 재시작으로 단순화할 수 없다. |
| PWA push·click | activation/handshake와 구 messaging worker 해제 순서는 기존 push 구독을 보존한다. 알림 facade 한 줄 위임은 수집·알림 담당 변경에서 직접 export로 축소한다. |
| PWA logout·Android 차이 | sessionCache의 사용자 runtime cache 제거 확인과 Android worker 해제를 유지한다. 불필요한 두 번째 native PWA 인증/등록 흐름을 만들지 않는다. |

## 외부 작업: 유지

| 계약 | 실제 경계와 이유 |
|---|---|
| ExternalResult / 공급자 metadata | SafeExternalTextHttp 및 각 실제 provider adapter의 성공·NoData·retryable·contract/invalid 결과가 다른 갱신 정책으로 소비된다. 오류를 0원/빈 성공으로 바꾸지 않는다. |
| ExecuteWithRetry | safeExternalTextHttpApplication의 URL/redirect allowlist·byte cap·timeout·제한 횟수는 외부 입력 경계다. 무제한 일반 fetch retry로 줄이지 않는다. |
| JobExecutionResult / RecordJobOutcome | trackedScheduledJob→scheduledJobExecutionApplication→Firebase repository. target receipt·실패 여부·fenced completeRun은 중복 업무 실행 방지에 필요하다. |
| HeartbeatJobRun | page별 checkpoint/lease 연장과 별도 heartbeat의 token 검증을 유지한다. heartbeat와 terminal 결과는 저장 조건이 다르다. |
| DetectMissingOrOverdueRuns | 시작 누락·heartbeat 초과·전체 deadline을 독립 관찰하며 실제 완료만 장애를 해제한다. test-only 강제 복구는 이미 제거됐다. |
| RecordProviderAttempt | 개별 통신 시도 관측으로 업무 성공을 생성하지 않는다. 원문·secret을 로그에 기록하지 않는 경계 유지. |
| RecordProviderRunOutcome | 실행 단위 receipt와 최종 시세/상태가 함께 저장된다. transient attempt 실패와 최종 장애를 합치지 않는다. |
| GetProviderHealth | providerHealthApplication의 최근 성공값 유지, 기대하지 않은 NoData 정상 처리, 연속 실패/즉시 계약 실패 구분을 유지한다. |
| RefreshBillingCostSummary | 실제 scheduled SystemActor만 Billing reader 결과를 저장한다. 사용자 홈 조회에 외부 비용 API를 끼워 넣지 않는다. |
| GetBillingCostSummary | 관리자만 최신 성공 snapshot을 읽고 실패/신선도를 확인한다. 권한 검사를 공용 provider read에 묻지 않는다. |

## 배포 검증: 유지

`verifyCandidate`, `qualitySummary`, `ResolveDeploymentTarget`, `VerifyCompatibilityWindow`, `RecordDeploymentResult` 다섯 계약 모두 `deploy-firebase.mjs`, 실제 CI, compatibility/provenance application에 연결되어 있다. clean HEAD/hash·actor·대상·Secret binding·lease·smoke marker와 CI의 다섯 독립 결과는 서로 다른 증거다. 준비 build 중복과 과거 문법 강제는 이미 정리되어 있으며 확인 항목을 없애 코드량을 줄이지 않는다. 이번 제품 변경도 같은 wrapper를 사용한다.

## Reporting: 이전 완료와 유지

- ResolveExpenseStatisticsPeriod: 실제 `statisticsPeriod`의 서울 월·사용자 범위·역전 범위 처리를 유지한다.
- BuildExpenseStatistics / ResolveInitialTrendCategories: 직전 `676731d9`의 단일 집계·부모 선택 소유·Chart 참조 안정성을 재사용한다. [지출 차트 검증](../../operations/expense-chart-simplicity-2026-10-05.md).
- BuildAssetStatistics: `37f7d40`·`f0d8149`의 공통 trend series와 조회 캐시 책임 정리를 재사용한다. [자산 통계 검증](../../operations/asset-statistics-refresh-2026-10-05.md).
- BuildCategoryDetail: 원장 원본 선택 snapshot과 편집 Command를 사용한다. 이번 모달 중복 초기화 제거가 적용되며 집계 원천을 별도로 복제하지 않는다.
- 조회 캐시의 actor/범위/revision/confirmed version 조건은 부분 변경과 늦은 응답 격리에 필요하다. [유지 조건](../../operations/simplicity-retention-decisions-2026-10-05.md)의 근거가 현재에도 유효하다.

## 실행 코드량

아래 값은 이 문서 담당 변경 파일 전체이며 새로 만든 실행 helper 파일은 없다. 다른 담당 변경·기존 chart 감소량과 합치지 않는다.

| 파일 | 변경 전 | 변경 후 |
|---|---:|---:|
| `web/src/components/expense/ExpenseEditModal.tsx` | 706 | 665 |
| `functions/src/platform/home-preferences/domain/homeSummary.ts` | 22 | 24 |
| `functions/src/platform/home-preferences/application/homePreferenceRuntimeApplication.ts` | 158 | 151 |
| `functions/src/adapters/firebase/home-preferences/firebaseHomePreferenceAtomicStore.ts` | 316 | 302 |
