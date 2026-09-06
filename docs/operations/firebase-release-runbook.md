# Firebase release 실행 절차

이 절차는 승인받은 운영자가 Firebase Functions의 세 codebase, Firestore Rules·index, Storage Rules를 하나의 후보로 배포하는 방법입니다. 명령을 기록한 것만으로 배포가 승인되지는 않습니다. Web 호스팅, Android APK, Storage CORS, 데이터 migration과 TTL 백필은 별도 절차입니다. 외부 리소스 준비는 [배포 전 외부 설정](deployment-prerequisites.md)을 따릅니다.

## 1. 후보와 실행 환경 준비

- Node.js 22, Java 21, 저장소의 Functions·Web 의존성, 인증된 GitHub CLI와 Application Default Credentials가 필요합니다. Firebase CLI는 설치된 Web workspace의 `firebase-tools`를 사용합니다.
- 운영자는 manifest의 `authorizedActorIds`에 등록된 GitHub 로그인 계정이어야 합니다. ADC에는 해당 Firebase 배포, Secret version metadata 읽기, Monitoring channel 읽기, 배포 승인·기록·잠금 저장소 접근 권한이 필요합니다.
- 변경 내용을 commit하기 전에 `npm --prefix functions run test:quality-gate`를 실행합니다. Web 또는 Android 변경 시 해당 활성 테스트와 production build도 실행합니다. 실패가 있으면 commit·push·배포를 진행하지 않습니다.
- push한 **같은 HEAD**의 `quality-gates.yml`이 완료되어야 합니다. `functions`, `web`, `web-e2e`, `android`, `android-instrumentation` 다섯 job 모두 `success`여야 하며, 누락·pending·실패·취소·skip은 차단됩니다.
- working tree는 깨끗해야 합니다. manifest와 smoke token은 저장소 밖에 둡니다. 운영 실행 환경에 `FIRESTORE_EMULATOR_HOST`나 `FIREBASE_AUTH_EMULATOR_HOST`를 설정하지 않습니다.

CI는 Functions unit·contract·형식·architecture·Rules/Storage/실제 Firebase integration, Web unit·production build·E2E, Android JVM·lint·Debug/Release build·instrumentation을 실행합니다. wrapper는 같은 CI 실행의 실제 Functions/Web JSON과 Android unit XML을 읽어 활성 테스트 수와 실패·skip 수를 평가합니다. build·Emulator·E2E 완료 여부는 필수 job 성공 결과로 확인합니다. CI 보고서가 없거나 만료된 경우 같은 HEAD에서 CI를 다시 실행합니다.

## 2. manifest 고정

저장소 루트에서 다음 명령으로 로컬 필수 Functions gate와 build를 실행하고 세 codebase를 준비한 뒤 hash를 계산합니다. 이 모드는 Cloud 요청이나 배포를 하지 않습니다.

```powershell
npm --prefix functions run deploy -- --print-hashes
Copy-Item -LiteralPath docs/operations/firebase-release-manifest.example.json `
  -Destination "$env:TEMP\household-release.json"
```

gate 출력 다음에 표시되는 마지막 JSON의 `commitSha`, `artifact`, `dependencyLockHash`, `contractHash`, `rulesHash`, `indexesHash`를 manifest에 옮깁니다. `artifact`는 manifest의 `artifacts` 배열 원소입니다. [예시 manifest](firebase-release-manifest.example.json)의 0으로 채운 hash와 `REPLACE_WITH_*` 값은 실행 가능한 값이 아닙니다.

- `releaseId`는 새 배포 식별자이며 `compatibility.releaseId`와 같아야 합니다. 기존 release에 다른 후보를 덮어쓸 수 없습니다.
- project와 environment는 예시의 production 값으로 고정합니다. 다섯 resource binding을 모두 유지합니다.
- `authorizedActorIds`는 실제 승인된 GitHub 계정, `monitoringChannelReference`는 검증되고 활성화된 실제 channel로 바꿉니다.
- Monitoring GET의 `VERIFIED`와 검증 면제 상태(필드 생략·`VERIFICATION_STATUS_UNSPECIFIED`)는 활성 channel에 한해 허용합니다. `UNVERIFIED`, 비활성, 다른 resource 응답과 조회 실패는 차단합니다. 이는 [Google Monitoring API의 상태 의미](https://cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.notificationChannels)를 따릅니다.
- `secretReferences`는 Secret 원문이 아닌 활성 version reference입니다. 현재 runtime에 필요한 `SHORTCUT_CREDENTIAL_PEPPER`를 반드시 포함합니다. 검토와 실행 사이 version 변경을 피하려면 승인된 숫자 version을 지정합니다.
- 공유 계약을 바꾸는 후보는 변경을 `compatibility.sharedContractChanges`에 선언하고 각 변경에 정확히 하나의 plan을 둡니다. 예시의 빈 배열은 공유 계약 변경이 없을 때만 유효합니다. 자동으로 소스 diff에서 변화 목록을 추정하지 않습니다.

호환 plan에는 서로 다른 `oldContractVersion`·`newContractVersion`, 시작/종료 시각, `minimumSupportedClients`, `expand` → `migrate` → `contract` 순서의 `steps`와 각 단계의 `rollbackCheckpoint`가 필요합니다. FID 변경(`fid-token-to-fid`)과 Membership claim 변경(`legacy-membership-to-claims`)은 [상세 설계](../requirements/supporting-platform/modules/delivery-assurance/design.md#53-호환-전환-예)의 capability 순서도 지켜야 합니다. 일반 계약 변화는 `generic-shared-contract` plan으로 기술합니다. 실제 client 배포와 migration·관측 증거를 검토한 뒤 해당 단계의 서버 후보를 실행합니다.

artifact hash에는 세 Functions codebase의 실제 배포 JS와 package·lock이 포함됩니다. 전체 계약, Rules, index는 각각 별도 hash로 고정합니다. 인증된 Query 성공 응답에 실리는 deployment marker는 이 hash를 참조하므로 marker JSON 자체만 hash에서 제외합니다. 코드나 설정을 바꾸면 gate·commit·CI·manifest를 다시 준비합니다.

## 3. 배포 없는 검증

```powershell
npm --prefix functions run deploy -- `
  --project household-account-6f300 `
  --manifest "$env:TEMP\household-release.json" `
  --check
```

이 명령은 로컬 gate·build, 정확한 HEAD의 CI와 보고서, hash, 운영 대상·호환 계획, GitHub actor, Secret version metadata, Monitoring channel을 검증합니다. 로컬 build/marker 파일은 생성하지만 Cloud 배포나 Firestore 승인은 기록하지 않습니다. `kind: approved`는 이 후보의 검사 통과 결과이며 이후 파일 변경을 허용하는 우회 권한이 아닙니다.

## 4. 승인된 운영 배포

smoke에 사용할 활성 가구 구성원의 최신 Firebase ID token을 저장소 밖의 접근 제한된 파일에 준비합니다. token을 명령 인자·manifest·로그·버전 관리에 넣지 않습니다. 긴 gate 실행 중 만료되지 않도록 실행 직전에 갱신합니다.

```powershell
npm --prefix functions run deploy -- `
  --project household-account-6f300 `
  --manifest "$env:TEMP\household-release.json" `
  --smoke-token-file "$env:TEMP\household-smoke.id-token"
```

wrapper는 모든 검증을 다시 수행하고 승인과 CI 근거를 `approvedReleases/{releaseId}`에 저장합니다. `deploymentLeases/{projectId}`를 transaction으로 획득한 한 실행만 Firebase CLI를 시작합니다. Functions predeploy는 **build 후 guard** 순서로 실행하며, guard가 다시 필수 gate와 hash·actor·현재 배포 잠금 소유자를 확인합니다. Rules와 Storage predeploy에도 같은 guard가 연결됩니다. 직접 `firebase deploy`를 실행하거나 `--guard`용 환경 변수를 수동으로 구성하지 않습니다.

배포 후 smoke는 인증된 사용자 해석과 실제 가구 Query를 호출하고 성공 응답의 release ID·commit SHA·artifact SHA가 승인 후보와 정확히 같은지 확인합니다. 예전 서버의 정상 응답은 통과하지 않습니다. 이 smoke는 공용 인증·Query 경로를 확인하며 Android App Check·결제 수집·WebView bridge의 전체 업무 흐름을 대신하지 않습니다. 해당 경로는 필수 CI/Emulator/E2E와 외부 설정 점검에서 별도로 검증합니다.

결과는 `deploymentProvenance/{releaseId}`에 기록하고 성공한 경우에만 프로젝트 잠금을 해제합니다. 승인 manifest와 provenance는 자동 TTL 없이 보존하며 Secret/token 원문을 기록하지 않습니다.

## 5. 실패·재시도·rollback

- gate·HEAD·hash·actor·외부 resource 검증 실패는 원인을 고친 후 처음부터 검사합니다. skip·force·waiver로 실패를 성공 처리하지 않습니다.
- `DEPLOYMENT_IN_PROGRESS`는 이전 배포 잠금이 남아 있다는 뜻입니다. 성공한 실행은 자동 해제합니다. 실패·중단된 실행은 잠금을 보존하며 시간 경과만으로 재배포를 허용하지 않습니다.
- 실패 후 운영자는 기존 배포 프로세스가 종료됐고 Firebase/Cloud의 배포 작업도 더 이상 진행 중이지 않은지 확인합니다. 실제 배포 상태와 실패 provenance를 검토한 후 해당 잠금 문서의 release ID·소유자를 재확인하여 명시적으로 제거합니다. 진행 여부를 알 수 없는 잠금은 제거하지 않습니다.
- CLI 실패·smoke 실패·marker 불일치를 정상 완료로 보고하지 않습니다. 실패 provenance가 저장되기 전에 프로세스가 종료됐다면 승인·CI·CLI/Cloud 작업 기록과 남은 잠금으로 조사합니다. 네트워크 장애로 기록이 실패한 경우에도 배포 성공으로 추정하지 않습니다.
- 수정 재배포나 rollback은 새 `releaseId`, 검증된 commit/artifact, 동일한 필수 gate와 호환 계획으로 새 후보를 만듭니다. 기존 실패 기록을 성공으로 덮어쓰지 않습니다. rollback의 `rollback` 필드는 provenance 계약에 맞는 `{strategy: 'rollback' | 'forward-fix', checkpointId, outcome: 'succeeded' | 'failed', evidenceLink}`를 기록합니다.
- 작업이 끝나면 로컬 smoke token 파일을 삭제하고 조직의 release 증거 보존 위치에 manifest와 CI 실행 링크를 보관합니다. 데이터 migration·TTL 백필은 [별도 runbook](runtime-migration-runbook.md)의 범위와 승인을 따릅니다.
