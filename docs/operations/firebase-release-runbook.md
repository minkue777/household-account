# Firebase release 실행 절차

이 절차는 승인받은 운영자가 Firebase Functions의 세 codebase, Firestore Rules·index, Storage Rules 중 변경된 대상을 하나의 후보에서 선택하여 배포하는 방법입니다. 명령을 기록한 것만으로 배포가 승인되지는 않습니다. Web 호스팅, Android APK, Storage CORS, 데이터 migration과 TTL 백필은 별도 절차입니다. 외부 리소스 준비는 [배포 전 외부 설정](deployment-prerequisites.md)을 따릅니다.

## 1. 후보와 실행 환경 준비

- Node.js 22, Java 21, 저장소의 Functions·Web 의존성, 인증된 GitHub CLI와 Application Default Credentials가 필요합니다. Firebase CLI는 설치된 Web workspace의 `firebase-tools`를 사용합니다.
- 운영자는 manifest의 `authorizedActorIds`에 등록된 GitHub 로그인 계정이어야 합니다. ADC에는 해당 Firebase 배포, Secret version metadata 읽기, Monitoring channel 읽기, 배포 승인·기록·잠금 저장소 접근 권한이 필요합니다.
- 로컬 전체 테스트 완료를 기다리지 않고 변경을 push하여 CI를 실행합니다. 변경에 필요한 빠른 검증이나 실패 원인 재현은 로컬에서 수행할 수 있지만 전체 CI를 push 전에 반복하는 것은 필수 조건이 아닙니다. 배포하는 surface의 production build·Android 서명·실제 배포 smoke는 유지합니다.
- main push 후 Vercel Git 자동배포와 `quality-gates.yml` 원격 CI가 병행 실행됩니다. 배포는 원격 CI 완료를 기다리지 않습니다. PR도 CI를 실행합니다. `functions`, `web`, `web-e2e`, `android`, `android-instrumentation` 다섯 job의 실제 결과는 별도 `quality-summary`에 기록됩니다. `android-instrumentation`은 [변경 범위 판정](../../tools/ci/android-instrumentation-scope.mjs)에 해당할 때만 에뮬레이터를 실행하며, 미해당이면 범위 확인 성공으로 기록합니다. main의 다른 commit이 push되어도 이전 commit의 CI를 취소하지 않습니다.
- working tree는 깨끗해야 합니다. manifest와 smoke token은 저장소 밖에 둡니다. 운영 실행 환경에 `FIRESTORE_EMULATOR_HOST`나 `FIREBASE_AUTH_EMULATOR_HOST`를 설정하지 않습니다.

CI는 Functions unit·contract·형식·architecture·Rules/Storage/실제 Firebase integration, Web unit·production build·E2E, Android JVM·lint·Debug/Release build·instrumentation을 실행합니다. wrapper는 CI를 조회하거나 보고서를 내려받지 않고 `ci: { policy: 'independent', workflow: 'quality-gates.yml', commitSha, status: 'not-evaluated' }`를 배포 승인 근거에 기록합니다. 이는 CI pending이나 success라는 추정이 아닙니다. 실제 상태는 해당 commit의 Actions 실행에서 확인합니다.

CI 실패는 GitHub의 실패 check와 summary에 남습니다. [GitHub Actions 알림 설정](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications)에서 `Only notify for failed workflows`를 선택하면 실행을 시작한 사용자의 활성화된 알림 경로로 받을 수 있습니다. 저장소는 계정 알림 설정을 바꾸거나 Slack·email을 직접 발송하지 않으며 수신 여부를 보장하지 않습니다. 배포와 CI 결과를 각각 전달하고 CI 문제는 원인·영향을 확인하여 후속 수정합니다.

push 이후 CI를 확인하고 실패하면 로그를 읽어 수정한 뒤 다시 push합니다. 구현·필요한 실제 배포가 끝나면 개발 작업을 먼저 마무리하고, 실행 중인 E2E/CI는 정확한 SHA와 실행 링크를 기록하여 후속 확인으로 넘깁니다. CI 검증 완료는 다섯 필수 검사와 workflow가 실제 성공한 뒤에만 보고합니다. 실패한 검사를 skip하거나 성공으로 바꾸지 않습니다.

## 2. manifest 고정

먼저 clean commit에서 읽기 전용 배포 계획을 확인합니다. 이 명령은 build·smoke·운영 쓰기를 수행하지 않습니다.

```powershell
npm --prefix functions run deploy -- --plan --project household-account-6f300
```

wrapper는 가장 최근 성공 provenance의 commit부터 현재 HEAD까지 누적 변경을 비교합니다. `targets`가 비어 있으면 Firebase 배포·manifest·smoke 준비를 생략합니다. Rules, index, Storage와 세 Functions codebase는 각각 선택합니다. 공용 `functions/src`, 계약, build 도구 변경은 세 codebase 모두에 적용됩니다. 테스트·배포 도구·문서만 변경된 경우 운영 runtime을 재배포하지 않습니다. Git 이력이 없어 비교할 수 없으면 오류로 중단합니다.

실제 배포에서는 같은 계획을 다시 계산하고 lease 획득 뒤 기준이 바뀌지 않았는지 재확인합니다. 승인 evidence의 `scope`에 기준 release·commit, 실제 targets와 Query 서버의 예상 marker를 보존하며 guard가 재검증합니다. 첫 배포는 전체 범위입니다. 이전 실패 배포를 복구하거나 Git 변경 없이 전체 재배포가 필요한 명시적 운영 작업은 manifest에 `deployAll: true`를 지정합니다. `--plan --all`로 그 범위를 미리 볼 수 있습니다. 실패한 배포의 lease 검토·해제 절차는 그대로 적용됩니다.

저장소 루트에서 다음 명령으로 Functions production build를 실행하고 세 codebase를 준비한 뒤 hash를 계산합니다. build lifecycle의 architecture 검사는 유지하며 전체 테스트를 재실행하지 않습니다. 이 모드는 Cloud 요청이나 배포를 하지 않습니다.

```powershell
npm --prefix functions run deploy -- --print-hashes
Copy-Item -LiteralPath docs/operations/firebase-release-manifest.example.json `
  -Destination "$env:TEMP\household-release.json"
```

build 출력 다음에 표시되는 마지막 JSON의 `commitSha`, `artifact`, `dependencyLockHash`, `contractHash`, `rulesHash`, `indexesHash`를 manifest에 옮깁니다. `artifact`는 manifest의 `artifacts` 배열 원소입니다. [예시 manifest](firebase-release-manifest.example.json)의 0으로 채운 hash와 `REPLACE_WITH_*` 값은 실행 가능한 값이 아닙니다.

- `releaseId`는 새 배포 식별자이며 `compatibility.releaseId`와 같아야 합니다. 기존 release에 다른 후보를 덮어쓸 수 없습니다.
- project와 environment는 예시의 production 값으로 고정합니다. 다섯 resource binding을 모두 유지합니다.
- `authorizedActorIds`는 실제 승인된 GitHub 계정, `monitoringChannelReference`는 검증되고 활성화된 실제 channel로 바꿉니다.
- Monitoring GET의 `VERIFIED`와 검증 면제 상태(필드 생략·`VERIFICATION_STATUS_UNSPECIFIED`)는 활성 channel에 한해 허용합니다. `UNVERIFIED`, 비활성, 다른 resource 응답과 조회 실패는 차단합니다. 이는 [Google Monitoring API의 상태 의미](https://cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.notificationChannels)를 따릅니다.
- `secretReferences`는 Secret 원문이 아닌 활성 version reference입니다. 현재 runtime에 필요한 `SHORTCUT_CREDENTIAL_PEPPER`와 `FUND_NAV_RELAY`를 반드시 포함합니다. 후자는 기준가 전용 중계의 HTTPS `url`과 인증 `token`을 담은 JSON이며, 중계 설치·인증 및 공식 기준가 조회 성공을 확인한 뒤 배포합니다. 검토와 실행 사이 version 변경을 피하려면 승인된 숫자 version을 지정합니다.
- 공유 계약을 바꾸는 후보는 변경을 `compatibility.sharedContractChanges`에 선언하고 각 변경에 정확히 하나의 plan을 둡니다. 예시의 빈 배열은 공유 계약 변경이 없을 때만 유효합니다. 자동으로 소스 diff에서 변화 목록을 추정하지 않습니다.

호환 plan에는 서로 다른 `oldContractVersion`·`newContractVersion`, 시작/종료 시각, `minimumSupportedClients`, `expand` → `migrate` → `contract` 순서의 `steps`와 각 단계의 `rollbackCheckpoint`가 필요합니다. FID 변경(`fid-token-to-fid`)과 Membership claim 변경(`legacy-membership-to-claims`)은 [상세 설계](../requirements/supporting-platform/modules/delivery-assurance/design.md#53-호환-전환-예)의 capability 순서도 지켜야 합니다. 일반 계약 변화는 `generic-shared-contract` plan으로 기술합니다. 실제 client 배포와 migration·관측 증거를 검토한 뒤 해당 단계의 서버 후보를 실행합니다.

artifact hash에는 세 Functions codebase의 실제 배포 JS와 package·lock이 포함됩니다. 전체 계약, Rules, index는 각각 별도 hash로 고정합니다. 서버가 제공하는 deployment marker는 이 hash를 참조하므로 marker JSON 자체만 hash에서 제외합니다. 코드나 설정을 바꾸면 build·commit·manifest를 다시 준비하고 새 commit의 CI를 별도로 실행합니다.

## 3. 배포 없는 검증

```powershell
npm --prefix functions run deploy -- `
  --project household-account-6f300 `
  --manifest "$env:TEMP\household-release.json" `
  --check
```

이 명령은 build, clean HEAD와 hash, 운영 대상·호환 계획, GitHub actor, Secret version metadata, Monitoring channel을 검증합니다. 로컬 build/marker 파일은 생성하지만 Cloud 배포나 Firestore 승인은 기록하지 않습니다. `kind: approved`는 배포 후보 검증 결과이며 CI 성공이나 이후 파일 변경을 허용한다는 뜻이 아닙니다.

## 4. 승인된 운영 배포

기본 배포는 가계부 사용자 로그인과 smoke token 없이 실행합니다. 승인된 운영자의 GitHub·ADC 인증은 그대로 필요하며, 앱 사용자의 인증·Membership 권한은 변경하지 않습니다.

```powershell
npm --prefix functions run deploy -- `
  --project household-account-6f300 `
  --manifest "$env:TEMP\household-release.json"
```

wrapper는 배포 검증을 수행하고 승인과 독립 CI 참조를 `approvedReleases/{releaseId}`에 저장합니다. `deploymentLeases/{projectId}`를 transaction으로 획득한 한 실행만 Firebase CLI를 시작합니다. wrapper는 architecture 검사와 production build를 한 번 수행하고 세 codebase 결과물을 준비합니다. Functions predeploy는 **동일 artifact를 재검증하는 guard만** 실행하며 hash·clean HEAD·actor·현재 배포 잠금 소유자를 다시 확인합니다. guard는 전체 테스트나 build를 다시 실행하지 않습니다. 변경되거나 오래된 결과물은 manifest hash 검증에서 거절됩니다. Rules와 Storage predeploy에도 같은 guard가 연결됩니다. 직접 `firebase deploy`를 실행하거나 `--guard`용 환경 변수를 수동으로 구성하지 않습니다.

배포 후 기본 smoke는 실제 서버의 release ID·commit SHA·artifact SHA가 예상 marker와 정확히 일치하는지 확인하고, 비로그인 가구 Query가 `AUTH_REQUIRED`로 거부되는지 확인합니다. 거부 대신 성공하거나 marker가 누락·불일치하면 실패입니다. `functions:default`를 배포했다면 새 후보 marker만 허용합니다. Rules·index 또는 child codebase만 배포했다면 Query 서버는 바꾸지 않았으므로 이전 성공 배포의 정확한 marker를 유지·검증합니다. 부분 배포가 이어져도 승인 evidence에서 그 marker를 계승합니다.

기존 `executeHouseholdQuery`에 token 없이 `access.list-asset-owner-profiles.v1`을 호출하고 가구 ID는 실제 가구 대신 `deployment-smoke-no-household`를 사용합니다. 응답 계약·query ID·거부 결과·`AUTH_REQUIRED`·`retryable=false`와 `deployment`의 세 marker 필드를 함께 확인합니다. 새 진단 endpoint는 추가하지 않으며 비인증 거부 응답에 공개하는 값은 release·commit·artifact 식별자뿐입니다. 가구 조회 권한이나 데이터를 공개하지 않습니다.

기본 smoke 성공은 실제 사용자 로그인·Membership 해석·가구 조회의 성공을 뜻하지 않습니다. 이들 권한 계약과 Android App Check·결제 수집·WebView bridge의 업무 경로는 CI/Emulator/E2E에서 별도로 검증합니다. 운영 사용자 경로 확인이 필요하면 아래 선택적 smoke를 추가합니다. 배포 검사를 위해 사용자 세션을 위조하거나 운영 가구·금융 데이터를 만들거나 수정하지 않습니다.

결과는 `deploymentProvenance/{releaseId}`에 기록하고 성공한 경우에만 프로젝트 잠금을 해제합니다. `adapterDiagnostics`의 `DEPLOYMENT_AUTH_BOUNDARY_SMOKE`와 `USER_ACCESS_NOT_CHECKED` 또는 `USER_ACCESS_CHECKED`로 검사 범위를 구분합니다. 승인 manifest와 provenance는 자동 TTL 없이 보존하며 Secret/token 원문을 기록하지 않습니다.

### 선택적 실제 사용자 인증 smoke

`--smoke-token-file`을 명시한 경우에만 기본 smoke에 인증된 사용자 해석·실제 가구 Query 성공 검사를 추가합니다. 명시한 파일의 누락·만료·권한 실패는 배포 smoke 실패이며 기본 검사로 조용히 대체하지 않습니다.

```powershell
node functions/scripts/prepare-smoke-session.cjs --token-file "$env:TEMP\household-smoke.id-token"
npm --prefix functions run deploy -- `
  --project household-account-6f300 `
  --manifest "$env:TEMP\household-release.json" `
  --smoke-token-file "$env:TEMP\household-smoke.id-token"
```

유효한 기존 token은 재사용합니다. 로그인 URL이 나오면 에이전트가 연결된 PC 브라우저에서 `http://localhost:55318/`을 열어 기존 로그인을 복원하고 완료 표시 및 `smokeSession: ready` 또는 파일 생성을 확인합니다. 휴대폰 원격 사용자에게 localhost 접속을 요구하지 않습니다. 최초 로그인이나 실제 복원·갱신 실패 때만 사용자 조작을 요청합니다. 동일 브라우저 프로필의 Firebase 로그인 유지를 보존하고 완료 직후 자동 로그아웃하지 않습니다. 이 도구는 기존 Google 계정이 ADC 운영자와 일치하는지도 확인합니다.

token 파일은 저장소 밖에 두며 원문을 명령 인자·manifest·로그에 넣지 않습니다. Firebase ID token의 유효기간과 브라우저 로그인 유지기간은 다릅니다. 장기 갱신 자격은 Firebase SDK가 브라우저에 관리하고 CLI에는 이번 검사용 ID token만 전달합니다. Cloud CLI 인증은 이 사용자 권한 검사 결과를 대신하지 않습니다.

## 5. 실패·재시도·rollback

- build·HEAD·hash·actor·외부 resource 검증 실패는 원인을 고친 후 처음부터 검사합니다. skip·force·waiver로 실패를 성공 처리하지 않습니다. 전체 CI 실패는 독립 결과로 보고하고 영향을 조사하며 배포 성공 상태를 자동 변경하지 않습니다.
- `DEPLOYMENT_IN_PROGRESS`는 이전 배포 잠금이 남아 있다는 뜻입니다. 성공한 실행은 자동 해제합니다. 실패·중단된 실행은 잠금을 보존하며 시간 경과만으로 재배포를 허용하지 않습니다.
- 실패 후 운영자는 기존 배포 프로세스가 종료됐고 Firebase/Cloud의 배포 작업도 더 이상 진행 중이지 않은지 확인합니다. 실제 배포 상태와 실패 provenance를 검토한 후 해당 잠금 문서의 release ID·소유자를 재확인하여 명시적으로 제거합니다. 진행 여부를 알 수 없는 잠금은 제거하지 않습니다.
- CLI 실패·smoke 실패·marker 불일치를 정상 완료로 보고하지 않습니다. 실패 provenance가 저장되기 전에 프로세스가 종료됐다면 승인·CI·CLI/Cloud 작업 기록과 남은 잠금으로 조사합니다. 네트워크 장애로 기록이 실패한 경우에도 배포 성공으로 추정하지 않습니다.
- 수정 재배포나 rollback은 새 `releaseId`, 검증된 commit/artifact, 동일한 배포 검증과 호환 계획으로 새 후보를 만듭니다. 기존 실패 기록을 성공으로 덮어쓰지 않습니다. rollback의 `rollback` 필드는 provenance 계약에 맞는 `{strategy: 'rollback' | 'forward-fix', checkpointId, outcome: 'succeeded' | 'failed', evidenceLink}`를 기록합니다.
- 선택적 검사에서 사용한 로컬 smoke token 파일은 작업 뒤 삭제하고 조직의 release 증거 보존 위치에 manifest와 CI 실행 링크를 보관합니다. 데이터 migration·TTL 백필은 [별도 runbook](runtime-migration-runbook.md)의 범위와 승인을 따릅니다.
