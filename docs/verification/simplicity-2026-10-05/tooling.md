# 배포·검증 도구 simplicity 조사 — 2026-10-05

정적 검토만 수행했습니다. 제품 코드·설정·테스트를 수정하지 않았고 스크립트 실행, 테스트 실행, 네트워크 조회, 배포도 하지 않았습니다. 이 문서는 개선 후보와 읽은 범위의 증거이며 기능 오류의 실행 재현 결과가 아닙니다.

## 범위

실행 도구·workflow·declaration 본문과 연결된 설정을 검토했다. 최초 조사에서 남았던 성능 도구 테스트 4개는 [플랫폼 테스트](platform-tests.md)에서 완료했다. 실제 파일 범위는 [files.csv](files.csv)를 따른다. 수동 운영 CLI나 암시적으로 소비되는 .d.mts를 이름 참조가 없다는 이유로 미사용으로 분류하지 않았다.

## 기능 계약 지도

| 조사 계약 | 기존 계약/근거 | 진입 → 판정 → 저장/출력 | 실제 소비자 |
|---|---|---|---|
| CI-QUALITY | REL-001 / T-REL-001 | push·PR·수동 실행 → 다섯 job 실행 및 Android 범위 판정 → 각 결과 artifact, summary는 다섯 success만 완료 | quality-gates.yml → quality-summary.mjs; Functions/Web/Gradle scripts |
| RELEASE-FIREBASE | REL-002~004 / T-REL-002~004 | deploy CLI → clean exact SHA·artifact/lock/contract/rules/index·명시 project·actor·secret binding·channel·호환 창 → lease 획득·scope 재확인·Firebase deploy·실제 사용자 read smoke → provenance, 성공 시 lease 해제 | functions package deploy → deploy-firebase.mjs → 실제 delivery applications·FirebaseDeploymentProvenanceStore; firebase.json predeploy guard |
| RELEASE-WEB | REL-001/004, PWA artifact 동작 | Vercel Git 경로 판단 → production Next build → inline script hash 기반 CSP/보안 headers·service worker build ID 검증 → Vercel output config | web/vercel.json → vercel-ignore.cjs; web package build → finalize-production-artifact.cjs → productionSecurityPolicy.cjs |
| NATIVE-E2E | QE-005~013, AND-*; 실제 명령 관측 | demo Emulator 준비·실제 command seed → production Web+TLS proxy+ADB reverse → 실제 Activity/Keystore/Native Firebase → command gate 보류/해제·정식 명령 저장/충돌·실제 Web 조회 → JSON/structured log/performance artifact | Web scripts → emulator wrapper → native-firebase.mjs → native-web-runtime/native-command-gate/structured-log |
| EMULATOR-PROVIDER | EXT-001~003, 알림 전달 계약 | demo project·loopback·명시 flag 검사 → FCM/Cloud Logging 외부 transport만 대체 → 실제 domain/adapter/store 흐름은 유지 | firebase-emulators.mjs의 NODE_OPTIONS preload → firebase-fcm/google-cloud-transport; secret helper는 없는 local secret 파일만 생성 후 자신이 만든 파일만 회수 |
| OPS-MIGRATION | SYS-009, runtime-migration runbook | 운영자/project/household/mapping/scope → dry-run·해결 불가 보고·plan hash·checkpoint → 실제 migration builder/persistence의 원자 page 적용·reconciliation | functions package migrate:runtime → migrate-runtime.mjs → compiled operations/migration; 일반 API 연결 없음 |
| OPS-CONSOLIDATION | SYS-009, storage-consolidation 기록 | 원문/canonical 및 멤버/명의자/카테고리 전수 읽음 → 충돌은 issue, 누락 metadata만 patch → private plan/hash·전체 revision 사전검증·transaction 재검증 → 쓰기 후 대조 | consolidate-storage.mjs → ledger/payment/portfolio pure validators; 실제 Firestore 통합 테스트 |
| OPS-CLEANUP | SYS-009, 승인된 원본 정리 계약 | 의미 대조·Timestamp 왕복 backup → private wx artifact/hash → 명시 path·source/target/상위 asset revision 검증 → page transaction delete·부분 완료 재개·대상 생존 확인 | cleanup-consolidated-storage.mjs → consolidate inspect/encode/decode; cleanup integration test |
| OPS-BACKFILL | SYS-009 / JOB-ERR-002 | TTL: read-only plan/hash·invalid 거부·project 재확인 → updateTime precondition으로 Timestamp 변환. 자산이력: 원문/명의자 유일 매핑·동일성 → 없는 snapshot만 create·재대조. 예약상태: 같은 reducer로 historical latest 집계 → live summary와 같은 transaction에서 갱신 | 각 운영 runbook, ttl/asset-history/status-summary 실제 Firestore 통합 검사 |
| OPS-ACCESS | SYS-008/009, 관리자 운영 계약 | 명시 operator token/systemAdmin·household 확인 → 멤버/lifecycle repair/purge; 추가 purge 권한·정확 lease token/사유 hash 확인 → 실제 운영 application 및 audit | access-operations.mjs; set-system-admin-claim은 dry-run 기본·명시 apply로 기존 다른 claims 보존 |
| OPS-MONITORING | EXT-001, JOB-ERR-002, REL-002 | project/channel·dry-run → provider/job incident/monitor heartbeat 로그 metric과 alert policy를 create/update | configure-cloud-monitoring.ps1, deployment-prerequisites runbook; 실제 실행 상태는 조회하지 않음 |
| TRACEABILITY | 요구사항 단일 소유·실행 case 연결 | 문서 선언과 실제 TS AST/Kotlin 테스트 선언 → ID·mapping·예외의 존재 검사 → catalog/연결 표 및 architecture gate | update-catalog/executable-tests/e2e-coverage → requirement-test-traceability.test.ts |
| PERF-REPORT | performance-report-only-2026-09-17 사용자 결정 | 실제 Web/Native samples → 환경·metric·warmup/iteration 완전성 및 유효값 확인 → 시간 참고선 비교·JSON/Markdown/HTML → main 동일 repo CI artifact 검증·Pages 게시 → 게시한 source보다 오래된 완료 artifact만 정리 | 실제 reporter.ts와 native-firebase → statistics/budgets; html-report → performance-pages → publish-site/prune-artifacts |

## 우선 후보

### TOOL-01 — Android 영향 범위를 수동 파일명 목록으로 관리하면서 보조 도구 검사가 스스로 빠집니다

- 우선순위: 높음. 확신도: 높음(정적 제어 흐름 확정, 이번 조사에서 실행하지 않음).
- 근거: `tools/ci/android-instrumentation-scope.mjs:6-18`은 native-firebase/native-web-runtime만 명시하고, 이들의 실제 import인 `tools/e2e/native-command-gate.mjs`, `tools/e2e/structured-log.mjs` 및 각 테스트는 목록에 없습니다. `.github/workflows/quality-gates.yml:248-249`는 이 두 보조 도구 unit을 `steps.scope.outputs.required == 'true'`일 때만 실행합니다. 따라서 이 파일들만 바뀌는 push는 scope=false이고 보조 unit과 Native 실행 모두 생략됩니다. Functions의 scope unit은 별도 실행되지만 누락 경로를 사례에 넣지 않아 검출하지 못합니다(`functions/test/bootstrap/android-instrumentation-scope.test.ts:21-38`).
- 실제 소비자: native-firebase.mjs:9-10 import, CI helper unit step. name 검색은 tools/.github/functions/test/Web package 전체에서 확인했습니다.
- 더 작은 설계: 작은 Node 보조 도구 unit은 비용이 낮으므로 scope 밖에서 항상 실행하고, Native 실행의 변경 범위는 개별 파일명 열거 대신 명확한 관련 디렉터리 단위로 잡는 편이 단순합니다. 특별히 제외할 이유가 없는 e2e support를 일일이 추가하는 목록을 줄입니다. 자동 import graph 엔진을 새로 만드는 것은 권하지 않습니다.
- 삭제 가능한 요소: 보조 unit을 고비용 에뮬레이터 scope에 종속시킨 if, 지원 파일마다 늘어나는 allowlist 항목.
- 보존 계약: Web 화면/문서 변경만으로 emulator를 강제하지 않는 정책, push 전체 diff·PR merge-base·삭제/rename 감지·알 수 없는 diff 시 fail closed, 실제 Native 기능 검증.
- 검증 단위: helper-only change/scope-self change/Native 소비자 변경/Web-only 변경의 scope 표; 실제 helper unit exit code가 scope=false에서도 job 실패로 전달되는지. 기존 기능 assertion이나 제한시간 변경 없음.

### TOOL-02 — 현재 실행자가 쓰지 않는 과거 성능 PASS/FAIL 평가 모드를 계속 유지합니다

- 우선순위: 높음. 확신도: 높음(실제 caller 두 곳과 과거 보고 reader를 분리 확인).
- 근거: `tools/performance/budgets.mjs:115-158`은 reportOnly/diagnostic/ci 세 boolean으로 gate/report/diagnostic 분기를 유지하고, `:168-186`도 과거 gate용 Markdown을 계속 생성합니다. 실제 샘플 평가 호출은 `web/e2e-performance/reporter.ts:61-64`와 `tools/e2e/native-firebase.mjs:210-212`이며 둘 다 `reportOnly: true`입니다. false 호출은 조사 범위에서 policy/HTML 테스트입니다. `tools/performance/budgets.test.mjs:65` 이후 다수는 과거 gate 통과/실패와 각 환경 예외의 통과 판정을 계속 유지합니다.
- 계약 확인: `docs/operations/performance-report-only-2026-09-17.md`는 사용자 결정으로 시간값이 CI PASS/FAIL에 영향을 주지 않으며 과거 결과를 재평가하지 않는다고 명시합니다. 과거 HTML은 `html-report.mjs:94` 이후 저장된 verdict/budget을 읽으며 다시 평가하지 않습니다. 따라서 과거 보고서 호환을 위해 새 샘플 gate 평가 경로가 필요한 것은 아닙니다.
- 더 작은 설계: 새 샘플은 유효한 측정/잘못된 측정 + 참고선 초과 정보만 산출합니다. 로컬 진단과 정상 보고를 명시 mode로 나누고 과거 report rendering은 saved fixture로 보호합니다.
- 삭제 가능한 요소: 활성 caller가 없는 gate 평가 branch·gate용 Markdown 생성·gate 모드를 새로 돌려 historical HTML fixture를 만드는 테스트 결합. 참고선 상수·프로필·실측표본·과거 renderer 호환은 삭제 대상이 아닙니다.
- 보존 계약: 누락/중복/NaN/잘못된 warmup/표본 수/프로젝트/metric·기능 실패는 계속 실패; 50초 이상 느린 실제 표본도 원본 보존; CI 진단 mode 우회 금지; 과거 verdict 불변.
- 검증 단위: 실제 Playwright reporter subprocess 검사(`tools/performance/reporting.test.mjs`)에서 느리지만 완전한 측정은 reported, missing/malformed/functional-failure는 실패. 저장된 과거 JSON fixture는 renderer가 변경 없이 표시합니다. 기준 숫자를 늘리거나 검증을 약화하는 작업과 다릅니다.

### TOOL-03 — 동일 후보를 준비하는 build와 구조 검사를 한 흐름에서 반복합니다

- 우선순위: 중간~높음. 확신도: 높음(호출 중복 확정), 실제 시간 효과는 미측정.
- 근거: `functions/package.json:4` prebuild는 architecture를 실행합니다. CI는 `quality-gates.yml:34`의 전체 npm test(Vitest test/**/*.test.ts에 architecture 포함), `:38` build, `:46` callable-integration의 내부 재build(`functions/package.json:22`)로 동일 구조 검사를 반복합니다. Native CI는 `quality-gates.yml:285-286`에서 기능과 성능을 연속 실행하고 각 `native-firebase.mjs:182`가 `native-web-runtime.mjs:27`의 production Web build를 다시 수행합니다. Web E2E browser install도 workflow :138과 package pretest:e2e에 중복됩니다.
- 배포도 wrapper가 build한 뒤 `firebase.json`의 각 codebase predeploy build, child package의 root Functions build로 같은 root compile/architecture가 반복됩니다. guard는 marker를 다시 쓰고 artifact 동일성을 확인하므로 안전장치와 반복 준비를 구별해야 합니다.
- 더 작은 설계: 같은 job/같은 배포 후보는 명시적인 prepare 단계에서 한 번 만들고 이후 단계는 그 prepared artifact의 SHA·환경·hash를 확인해 소비합니다. 로컬 단독 실행은 준비가 없으면 기존처럼 build합니다. job 간 복잡한 cache 공유나 검증 결과 재활용 프레임워크보다 동일 프로세스 흐름의 중복 호출부터 제거합니다.
- 삭제 가능한 요소: 같은 변경 없는 흐름에서 중복하는 compile/browser install/동일 architecture 재실행. CI Functions/Web/Native 각각의 독립 기능 검사는 유지합니다.
- 보존 계약: fresh production artifact, source/lock/environment 일치, 원격 CI 독립, predeploy project/actor/lease/scope/hash/smoke 검증, 외부 direct deploy 차단, 실패 시 실제 exit code.
- 검증 단위: 명령 실행 순서를 가짜 runner로 기록해 동일 후보 build 횟수를 확인하고 stale artifact/다른 env/변경된 SHA는 거부; 실제 Emulator/Web/Native 통합 경로는 그대로 통과해야 합니다. 이번 조사에서는 build를 실행하지 않았습니다.

### TOOL-04 — 완료된 구형 이관용 reconciliation이 일반 runtime 명령처럼 남아 있습니다

- 우선순위: 중간. 확신도: 높음(저장소 경로 불일치 확인), 운영자가 현재 오용했다는 근거는 없음.
- 근거: `functions/scripts/reconcile-runtime.mjs:211-244`는 legacy flat collection과 구형 canonical을 비교하며 카테고리는 `:231`의 `households/{id}/categories`를 읽습니다. 현재 authority는 categoryCatalog/current이며 `consolidate-storage.mjs:117-126`의 canonicalOnly 경로도 이를 사용합니다. `docs/operations/storage-consolidation-2026-09-18.md`에는 원본 정리까지 진행한 기록이 있습니다. 그러나 package의 `reconcile:runtime` 및 deployment-prerequisites의 일반 명령은 여전히 이 첫 전환 도구를 가리킵니다.
- 영향: 정리 후 빈 old categories 두 쪽은 category MATCH가 될 수 있지만 현재 catalog를 검증한 결과가 아닙니다. 다른 canonical 거래가 있는 경우 전체 결과는 오히려 MISMATCH일 수 있습니다. 이를 현재 시스템의 정합성 검사로 해석하면 안 됩니다.
- 실제 소비자: npm reconciliation 명령·초기 migration runbook·모델 테스트. 추가로 `storage-consolidation-ledger.mjs:1`이 이 CLI 모듈의 normalizers를 import하므로 파일 통삭제는 잘못입니다.
- 더 작은 설계: 최초 legacy-flat-v1 전환 도구의 역할과 실행 범위를 이름/문서에서 한정하고 현재 운영 검증 메뉴에서 분리합니다. consolidation이 실제 사용하는 pure ledger 비교만 필요한 소유 위치로 둡니다. 과거 schema fixture를 현재 runtime validator에 계속 fallback으로 추가하지 않습니다.
- 삭제 가능한 요소: 현재 배포/진단 절차의 오래된 일반 명령 연결, 보존 업무값 normalizer를 포함한 CLI 전체 import 의존. 과거 감사/복구 자료 자체는 보존합니다.
- 보존 계약: 원문 read only·금액/identity hash·수동 mapping·기존 이관 감사 근거. 현재 schema를 구형 양식으로 강제로 고치거나 운영 데이터를 재이관하지 않습니다.
- 검증 단위: 구형 schema fixture의 기존 결과 보존, 현재 canonical-only 상태에서 구형 검사임을 명확히 판정, consolidation ledger 의미 대조 유지. 이번 조사에 운영 조회/수정은 없습니다.

### TOOL-05 — 요구사항 선언 파서가 세 군데에서 같은 규칙을 다시 구현합니다

- 우선순위: 중간. 확신도: 높음(중복 사실), 현재 집계 불일치가 발생했다는 의미는 아님.
- 근거: `tools/requirements/update-catalog.mjs:9,20-27`, `tools/requirements/executable-tests.mjs:81-90`, `functions/test/architecture/requirement-test-traceability.test.ts:47-98`에 requirements/context 파일 선정, 정확한 `## 5. 요구사항`/`## 6. 공통 요구사항` 제목, ID 표 파싱이 각각 존재합니다. 선택 경로가 modules 한정/requirements-context 전체/정규식 소유 루트로 조금씩 다릅니다. architecture suite가 다시 scripts를 subprocess로 읽고 자체 파서 결과와 개수도 비교합니다.
- 실제 소비자: catalog 생성, E2E 연결 생성·검사, architecture gate. 한 파서의 소비가 3개입니다.
- 더 작은 설계: 작은 순수 문서 선언 reader 하나가 단일소유 문서/ID/status를 반환하고 생성기와 검사가 이를 사용합니다. 별도 schema registry/플러그인 시스템을 추가할 필요가 없습니다. parser 자체는 소형 문서 fixture로 검증합니다.
- 삭제 가능한 요소: 동일 root 탐색·heading/ID regex·파싱 loop의 복사본과 그 복사본끼리만 맞추는 검사.
- 보존 계약: 요구사항/테스트 ID 중복 금지, 실제 실행 case 연결, 명시적 예외/참조 근거, 주석·fixture를 실행 증거로 세지 않음, 실행 연결을 모든 수용조건 통과로 과장하지 않는 보고 문구.
- 검증 단위: 정상 문서/중복ID/다른 heading/escaped pipe/링크형 ID fixture, 현재 생성 문서 동일성, Kotlin·TS 선언 수집과 수동 mapping 유효성. 실제 테스트 성공은 runner 보고서로만 판단합니다.

### TOOL-06 — 런타임 보안 경계 검사에 과거 폴더 이전 완료 조건이 섞여 있습니다

- 우선순위: 낮음~중간. 확신도: 높음(검사 성격), 현 동작 오류는 미확정.
- 근거: `tools/release/gates/runtime-boundary-audit.mjs:31-68`은 Web/Android 직접 Firestore write 차단이라는 실제 보안 경계를 검사합니다. 반면 `:72-109`의 이전 flat 모듈명 5개와 `:114-129`의 functions/src/platform/pwa·android-host 폴더 존재 금지는 과거 구조 이전 형태를 강제합니다. 이 gate는 npm test:runtime-boundaries로 매 CI에 수행됩니다.
- 더 작은 설계: 현재 행동 계약인 client privileged write 차단을 소유한 명확한 검사로 유지하고, 완료된 역사적 파일 이동 체크는 전환 근거에 남기거나 현재 공개 export의 실제 허용 책임 검사로 대체합니다. 특정 레이어/폴더명을 유지하는 것이 목적이 되어서는 안 됩니다.
- 삭제 가능한 요소: 소비자가 없는 예전 구현 모양만 금지하는 체크의 상시 runtime gate 결합. 보안 차단을 없애는 제안이 아닙니다.
- 검증 단위: 실제 클라이언트 write 금지와 공개 endpoint authority는 AST/import 분석 또는 실제 Rules/endpoint 경계 테스트로 보호; 합법적인 폴더/함수 rename이 정책위반이 되지 않음. regex scanner의 가상 우회 사례만으로 새 대형 정적 분석기를 만들 필요는 없습니다.

## 단순화해도 남겨야 하는 복잡성

- 배포 manifest hash/clean SHA/명시 project/actor/secret resource·monitoring channel/lease/provenance/실제 로그인 smoke는 서로 다른 실패를 막습니다. 단순 중복 검증으로 일괄 제거하지 않습니다. 실패 시 lease 보존이 복구 절차일 수 있으므로 이번 읽기만으로 무조건 finally-release로 고치지 않습니다.
- migration/consolidation/cleanup의 plan hash, 원문 Timestamp precision 왕복, updateTime, 상위 asset 검증, 부분 재개는 동시 변경과 데이터 손실을 방지합니다. 일회성 도구여도 복구 계약이 끝났다는 증거 없이 삭제하지 않습니다.
- Native command gate는 실제 명령을 보류/해제하고 실제 upstream 결과를 관측합니다. retry bypass·중단·timeout·body cap 처리는 즉시 반영/충돌 복구 계약 검증에 필요합니다. 제품 코드에 테스트를 위한 성공값을 끼워 넣지 않습니다.
- FCM/Cloud Logging preload shim은 demo·loopback·명시 flag 하에서 외부 전송 경계만 대체합니다. private SDK 접근은 업그레이드에 민감하지만 이를 제거하려고 제품 도메인에 mock state/실패 주입 계층을 추가하면 더 복잡해질 수 있습니다.
- prepare-android-ui는 부팅 launcher만 재시작하고 실제 HOME 입력 focus를 확인하며 앱 ANR을 무시하지 않습니다. 기존 실패 원인을 숨기는 예외로 분류하지 않았습니다.
- 성능 Pages의 main/동일 repo/run/artifact provenance, 경로·symlink 검증, HTML만 공개, 게시 뒤 오래된 완료 artifact만 삭제하는 제한은 공용 게시/삭제의 실제 안전 계약입니다. publish와 prune에 repository/numeric-ID 검증이 일부 중복되지만 2개의 짧은 명령 경계를 합치는 것이 우선 과제는 아닙니다.
- 공개 config에서 smoke 로그인용 key를 읽는 regex는 source 형식에 민감하지만 이번 조사에서 실제 실패 증거는 없습니다. 공개 config 하나를 읽는 작은 경계로 나중에 정리할 수 있으나 우선 후보로 올리지 않았습니다.

## 한계

도구와 테스트 본문은 읽었지만 실제 CLI·CI·배포를 실행하지 않았다. GitHub/Vercel 원격 설정·IAM·운영 상태, 실제 시간 절감량, 저장소 밖 소비자는 확인하지 않았다.

권장 첫 정비 단위는 TOOL-01/02입니다. 전자는 검사의 적용 범위를 더 믿을 수 있게 만들며, 후자는 사용자 결정을 반영한 현재 경로만 남겨 예전 예외·판정 코드를 제거할 수 있습니다. 배포·원본 삭제의 안전장치 축소보다 작은 위험으로 시작할 수 있습니다.
