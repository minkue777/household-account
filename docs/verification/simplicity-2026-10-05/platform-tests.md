# 플랫폼·접근·배포 도구 테스트 정적 조사

- 기준일: 2026-10-05. 제품·테스트·설정 변경, 테스트 실행, 네트워크 조회, 배포, commit은 하지 않았습니다.
- 범위: Functions 접근·플랫폼·공통·architecture·bootstrap·배포·외부 HTTP·이관 테스트/fixture와 도구 테스트를 본문 검토했다. 파일별 최종 범위는 [files.csv](files.csv)를 따른다.

- `full-read`는 본문 정적 검토를 뜻합니다. 실행 통과나 모든 오류 부재를 뜻하지 않습니다.

## 계약 흐름과 보장 수준

| 기능/계약 | 실제 흐름 | 검토 판단 |
|---|---|---|
| HH-001/002/003/007/JOIN-001 | callable/router → Auth·membership/claim → onboarding/legacy application → Firebase store·outbox·category initialization | 실제 Callable/Auth/Firestore 생성 왕복과 Access Emulator 통합이 있습니다. 반면 localStorage 정리 및 동시 create/join 계약 일부는 별도 fixture driver 또는 직렬 메모리 UOW만 검증합니다. |
| HH-009/T-HH-004 | rename handler → memberRename application → scoped Firebase store → member/profile/view/event | 단위 fixture는 모든 멤버를 주지만 실제 store는 현재 UID만 읽습니다. 같은 이름 충돌 계약의 adapter 연결이 끊깁니다. |
| HH-011/012·ADM-001/003 | profile/member/household lifecycle → transaction → stable identity·claim·view | 실제 Emulator의 profile rename/archive, 관리자 제거·복구·가구 논리 삭제 검사는 유지합니다. 고정 digest·clipboard 모형은 이 실제 저장 검사를 추가로 보장하지 않습니다. |
| SYS-001/T-SEC-001 | 검증 UID → router actor/manifest → handler / Client SDK → 실제 rules | 실제 Rules Emulator의 사용자·타 가구·관리자·무인증·쓰기 금지 행렬은 중요합니다. tenant fixture의 임의 CRUD는 Rules 실행이 아니며 서버 command 정책과 Client SDK 정책을 섞어 부르는 부분을 분리해야 합니다. |
| REL-001~004 | wrapper 후보검증 → 대상/해시/actor/호환성 → deploy marker·smoke·immutable provenance | 대상 오류, dirty artifact, child codebase hash, secret 저장 위치, smoke 불일치, immutable 기록 검사는 유지합니다. 정확한 shell 문구와 빌드 반복까지 고정할 이유는 없습니다. |
| JOB-ERR-001/002 | occurrence → lease·page·checkpoint → completeRun → summary·incident | 실제 SDK Emulator의 동시 요약 갱신과 transaction abort 검사가 있습니다. 메모리 lease/monitor fixture는 동일 보장을 대신하지 못하며 테스트에서만 가능한 terminal 전이가 있습니다. |
| EXT-003/KIND/MARKET-004 | safe HTTP → 제한된 재시도/redirect/size → KIND 검색·viewer·detail → provider observation·last quote | 현재 사용하는 HTTP 보호·cookie opt-in·KIND 문서 dedup/검색 건수 누락 감지·마지막 성공 가격 보존은 실제 app/adapter를 호출하므로 유지합니다. |
| ADM-005/Android startup | allowlist 진단 정규화 → app-visit handler → structured logger → Cloud Logging 집계 | 두 시계 구분, 민감 필드 차단, 구버전 누락 호환, 로그 실패의 업무 무간섭은 필요한 복잡성입니다. 과거 배포 날짜를 하드코딩한 집계 제외는 별도 정리 후보입니다. |
| 운영 migration/cleanup/TTL | dry-run 계획·원본 hash → 승인 → 실제 Firestore transaction → checkpoint·정밀 backup·재조회 | scope 격리, source/target drift, parent guard, 고아 문서, Timestamp nanosecond 보존, partial resume 검사는 삭제하면 안 됩니다. |

## 우선순위 후보

### PT-01 — 구조 검사로 복잡한 배포/분해 모형을 고정합니다 (높음)

- 근거: `functions/test/architecture/functions-deployment-codebase.test.ts:68`~96은 정확한 test:architecture, prebuild, child build의 `npm --prefix ../functions run build`, predeploy 문자열을 요구합니다. `runtime-migration-operations-boundary.test.ts:76`~91은 builder 400줄 미만·4개 collector 함수명·지정 폴더를 요구합니다.
- 소비자: package build/CI architecture suite. 앞선 TOOL-03의 같은 후보를 여러 번 build/architecture 검사하는 흐름과 직접 연결됩니다.
- 더 작은 설계/삭제: 배포 결과물의 export 목록·hash·실제 guard 진입 여부를 검사하고 정확한 shell 문구/collector 이름/줄 수 검사를 제거합니다. 빌드를 한 번 준비해 같은 후보 아티팩트를 사용해도 검증되게 합니다.
- 보존: codebase 격리, App Check·Auth, production target, 승인 artifact와 실제 smoke marker 일치, 운영 migration 비공개 경계.
- 검증 단위: CLI 후보 검증 및 artifact smoke, codebase export, 실제 migration dry-run/apply Emulator. 현재 검사 전체를 없애자는 제안이 아닙니다.

### PT-02 — fixture가 제품 경계의 행동을 직접 대신합니다 (높음)

- 근거: `legacy-membership-migration-fixture.ts:189`~192에서 driver가 localStorage 키를 지우고 session을 설정합니다. 계약 파일 14행은 Web 캡처와 전환을 함께 검증한다고 설명하고 230행 부근에서 그 효과를 assertion합니다. `admin-household-console-fixture.ts:154`가 clipboard effect를 직접 push하며 `admin-household-console.contract.test.ts:94` 부근은 이를 화면 복사 계약으로 셉니다. `household-purge-process-fixture.ts:417`은 purge 이후 로그인 결과를 직접 계산합니다. `member-removal-restoration-fixture.ts`의 다른 가구 가입도 실제 Google onboarding이 아닌 별도 상태 변경입니다.
- 더 작은 설계/삭제: Application 정책 검사는 실제 application 함수에 좁은 port 대역을 넣고, Web localStorage/clipboard나 재로그인 assertion은 실제 Web/계정 해석 경로의 테스트로 옮깁니다. 경계 밖 driver 업무 로직과 wrapper 인터페이스·위임 메서드를 제거합니다.
- 보존: claim 단일 소유, 자기 UID, invitation 일회성, 데이터 보존, purge 순서, 재로그인 결과.
- 검증 단위: Application 정책 테스트 + 이미 있는 실제 Access/Callable/Rules Emulator. 동시성은 직렬 fixture의 Promise.all만으로 완료 표시하지 않습니다.

### PT-03 — 상수로 저장된 자료를 비교하는 보존 assertion은 삭제 가능합니다 (높음)

- 근거: `household-lifecycle-fixture.ts:129/138/173` preservedData; `member-rename-fixture.ts:109/116/137` stableReferences; `member-removal-restoration-fixture.ts:210/268` businessDataDigest 및 notificationEndpointIds; `asset-owner-profile-fixture.ts:156/166/202` ownerReferences. 이 값은 실제 application/store가 변경할 수 없는 driver 전용 복사본입니다.
- 실제 소비자: 각 기능의 lifecycle/rename/removal/owner 계약 테스트. assertion이 통과해도 금융 원본·참조·endpoint 변경 방지 자체는 관찰하지 못합니다.
- 더 작은 설계/삭제: 상수 필드와 동등 비교 assertion을 제거하고, 해당 보존 계약은 실제 문서 seed → 실제 handler → 재조회 검사 한 곳에 모읍니다. 이미 Access/관리자/purge Emulator에 있는 보존 검사는 유지합니다.
- 한계: 서버 구현에 보존 보장이 전혀 없다는 뜻이 아닙니다. 이 단위 assertion이 추가 보장이 아니라는 지적입니다.

### PT-04 — 413줄 Firestore 대역의 SDK 의미 차이가 버그를 숨깁니다 (높음)

- 근거: `in-memory-firestore.ts:176/272`는 mergeFields를 boolean merge로 취급하고 `:386`은 nested map을 shallow replace합니다. `:348` transaction은 Firestore read conflict/retry를 재현하지 않습니다. own test 38줄은 query/transform/abort만 확인합니다.
- 실제 소비자: 여러 실제 Firebase adapter 단위 테스트. 특히 member-access 일별 count의 30일 pruning + 실제 merge:true가 이전 map key를 남기는 A09와 연결됩니다.
- 더 작은 설계: 대역을 SDK 복제품으로 더 키우지 않습니다. 순수 mapping 테스트의 작은 stub은 남기고 nested merge, field mask, 동일 문서 경쟁, lease fencing 원자성은 실제 Emulator 검사로 한정합니다.
- 보존: 보안·원자성 검증 자체. 실제 `firebase-scheduled-job-status-summary.integration.test.ts:38`의 동시 완료/초기화 경합과 `:57`의 commit 전 abort/retry는 좋은 사례입니다.

### PT-05 — RenameSelf 중복 이름 계약은 fixture에서만 충족됩니다 (높음)

- 근거: `member-rename.contract.test.ts:132` 부근은 같은 가구의 진선 이름으로 변경 시 DISPLAY_NAME_EXISTS를 요구합니다. fixture는 민규/진선 2명을 application에 공급합니다. 실제 `firebaseMemberRenameStore.ts:119/:170`은 현재 principalUid에 해당하는 멤버만 조회합니다.
- 실제 adapter/security/Access Emulator 파일 본문을 읽었으며 같은 이름의 다른 활성 멤버가 있는 Firebase 경로 검사는 없었습니다. 새 테스트를 실행해 재현했다고 주장하지 않습니다.
- 더 작은 설계: 이름 유일성 정책을 유지할지 요구사항/설계와 맞춘 뒤, 유지한다면 이름 충돌을 판단할 실제 범위가 transaction에 들어오도록 한 경계에서 처리합니다. fixture 전용 전체 상태나 후속 예외 추가로 덮지 않습니다.
- 보존: 자기 UID, 다른 멤버 무간섭, profile/view 동시 갱신, version/receipt/outbox, 동일 가구의 이름 정책.
- 검증: 실제 Firebase store에 활성 멤버 둘을 seed하고 중복/정상/동시 충돌을 검증합니다. HH-009 행 자체는 중복 이름을 상세히 적지 않지만 상세 설계와 현행 계약 테스트는 금지를 명시합니다.

### PT-06 — 실제 completion 경로와 다른 monitor 복구 API를 테스트가 살려 둡니다 (높음)

- 근거: `scheduled-job-monitor.contract.test.ts:320`은 recordRunRecovery로 terminal을 만듭니다. `scheduled-job-monitor-fixture.ts:35`의 saveRun은 무조건 저장합니다. 실제 `firebaseScheduledJobStores.ts:427`의 monitor saveRun은 terminal 쓰기를 거부하고 완료는 execution repository completeRun이 소유합니다.
- 더 작은 설계/삭제: 실제 호출자가 없는 recordRunRecovery 및 테스트 전용 복구 분기를 제거하고 completeRun → incident recovery 한 경로를 검증합니다. 이미 `scheduled-job-incident-recovery.test.ts`가 실제 두 repository를 연결합니다.
- 보존: terminal 역전 금지, stale lease, 기존 성공 receipt, 같은 incident 한 번 resolve, 48시간 이전 incident 복구.

### PT-07 — 과거 날짜 예외와 구 성능 gate를 테스트가 보존합니다 (높음)

- 근거: `google-cloud-interactive-latency-reader.test.ts:149/:214`가 2026-07-28/29 이전 표본 제외를 고정합니다. 실제 reader의 현재 24시간 조회에서는 이 날짜가 더 이상 들어오지 않습니다. 도구 `budgets.test.mjs` 대부분은 report-only 전환 이전 gate pass/fail이며 `html-report.test.mjs`도 과거 표시 fixture를 old evaluator로 생성합니다.
- 더 작은 설계/삭제: 과거 표시 호환은 저장된 JSON fixture 한 개로 확인하고 현재 실행 경로의 미사용 gate 계산과 오래된 날짜 분기를 없앱니다. report-only에서도 표본 누락·수치 무효·원인 관측은 유지합니다.
- 검증: 현재 reader 기간/중복 correlation/최종 outcome, report-only sample validity, 과거 HTML 표시를 각각 확인합니다.

### PT-08 — category 조회 최적화 검사가 최초 수정·삭제 경로를 타지 않습니다 (높음)

- 근거: `ledger-household-command-category-read.test.ts:47`은 항상 existing receipt와 receiptResult를 반환합니다. `:120`의 memo/delete/notification request "does not scan" 검사는 모두 replay에서 끝납니다. 이는 기존 receipt replay를 검증하지만 제목처럼 최초 업무 수행의 category I/O 절감을 모두 입증하지 않습니다.
- 더 작은 설계: replay는 명시된 마지막 사례로 묶고 최초 수정/삭제는 receipt 없는 상태에서 실제 adapter를 거쳐 category lookup을 관찰합니다. 같은 replay 조합 반복을 줄입니다.
- 보존: category 명시 변경의 유효성, receipt replay의 추가 읽기 없음, memo/delete 정상 저장, version 충돌.

### PT-09 — 일반 tenant CRUD 행렬이 실제 Rules 계약처럼 보입니다 (높음)

- 근거: `tenant-authorization.contract.test.ts:16`은 Rules와 공유하는 권한 행렬이라 설명하지만 일반 멤버의 create/update/delete를 allowed로 검증합니다. 실제 `firestore-rules.integration.test.ts`는 같은 멤버도 Client SDK 쓰기 전부 금지를 확인합니다. 정책의 실제 production 소비자는 `captureSubmissionAuthorization.ts:44`의 transactions/create 한 경우입니다.
- 더 작은 설계: 실제 capture 인가에 필요한 tenant 일치 조건으로 범위를 줄일 후보입니다. 일반 CRUD driver·records map·항상 빈 publishedEvents는 Rules 보장과 분리하고 필요 없는 모형은 삭제합니다.
- 보존: callable 서버에서의 검증 actor·tenant·submit capability와 Client SDK 쓰기 금지는 서로 다른 경계입니다. 두 정책의 결과 차이 자체를 보안 버그로 단정하지 않습니다.
- 소비자 검색: functions/src·functions/test·web/src·android/app/src/main에서 createTenantAuthorization/authorizeHouseholdAction/관련 타입을 검색했습니다. 실제 bootstrap은 capture에만 연결되고 resolver·CRUD 행렬의 대부분은 테스트 소비입니다.

## 유지할 검사와 이번 결론의 한계

- 보안: 인증 전 payload 처리 금지, client actor 위조 거부, 관리자 capability, production/emulator 혼합 차단, App Check/Rules, receipt 원문 secret 비저장, logger 민감 자료 제외.
- 원자성/복구: 실제 Emulator의 Access graph, 실제 migration source/target drift, cleanup 승인 계획·정밀 backup, purge orphan/subcollection·claim 충돌, scheduled summary 동시 transaction/abort.
- 외부 경계: HTTP 크기/host/redirect/timeout/retry/cookie, KIND 실제 adapter parsing과 건수 미달 실패, last success 보존. 필요 구조를 무조건 줄이면 안 됩니다.
- 중복 DTO/interface, createSubject passthrough, 5개 필수 binding/manifest 일정 하드코딩 반복도 읽었지만 의미 있는 안전 계약 없이 숫자만 줄이자는 후보로 추가하지 않았습니다. 우선 위 9개처럼 실제 호출·보장 차이가 확인되는 항목부터 작업하는 편이 낫습니다.
- 테스트를 실행하지 않았으며 과거 실행 성공 여부를 재확인하지 않았습니다. 이번 보고서는 단순화 계획과 검증 범위 재정렬의 정적 근거입니다.
