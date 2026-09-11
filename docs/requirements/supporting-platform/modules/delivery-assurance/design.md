# 배포 안전성 상세 설계

> 요구사항: [배포 안전성 요구사항](requirements.md#5-요구사항)  
> 상세 설계 규약: [모듈 상세 설계 규약](../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

`REL-001~004`를 배포 검증, 독립 CI 결과, 장기 배포 기록으로 구분합니다. [DEC-074](../../../governance/decisions.md#dec-074)에 따라 전체 CI 완료는 배포의 선행 조건이 아닙니다. 테스트 결과를 성공으로 바꾸는 waiver나 override 계층은 두지 않습니다.

## 2. 모듈 경계와 책임

- 배포 wrapper는 immutable manifest의 HEAD·artifact·대상·호환성·actor·Secret·Monitoring을 검증합니다.
- production build와 배포 후 실제 인증·가구 Query smoke가 배포 경로에 포함됩니다.
- 전체 unit·contract·Rules·E2E·Android 검증은 `quality-gates.yml`에서 별도로 실행됩니다.
- CI 결과는 commit별 GitHub run/check/summary로 남기며 배포 기록을 성공 또는 실패로 덮어쓰지 않습니다.

## 3. 공개 계약

| 실행 계약 | 호출자 | 결과 |
|---|---|---|
| `verifyCandidate(manifest, projectId, dependencies)` | 배포 wrapper·predeploy guard | 배포 authorization hash와 `ci.status=not-evaluated`, 또는 대상·hash·호환성 오류 |
| `qualitySummary(needs, commitSha, runUrl)` | CI 최종 요약 CLI | 다섯 job 결과와 commit·실행 링크·전체 CI conclusion |
| `ResolveDeploymentTarget(candidate)` | 배포 wrapper | resolved target 또는 `TARGET_MISMATCH` |
| `VerifyCompatibilityWindow(manifest)` | 배포 wrapper | compatible 또는 `INCOMPATIBLE_ORDER` |
| `RecordDeploymentResult(releaseId, result)` | 배포 후 runner | recorded·replayed 또는 target/artifact mismatch |

전체 CI 증거를 `deployAuthorization`으로 바꾸던 `ReleaseCandidateEvaluationApplication`은 제거합니다. 정상 배포 검증은 wrapper에서 실제 사용하며 CI 요약은 workflow가 실행합니다.

## 4. 플랫폼 모델과 불변식

- manifest는 releaseId·commit·세 Functions codebase artifact·lock·contract·Rules·index hash를 고정합니다.
- `ci = {policy: 'independent', workflow: 'quality-gates.yml', commitSha, status: 'not-evaluated'}`는 배포 승인 시점에 CI를 평가하지 않았다는 뜻입니다. pending·pass·fail 추정이나 가짜 run ID를 담지 않습니다.
- CI summary는 `functions`, `web`, `web-e2e`, `android`, `android-instrumentation`이 모두 success일 때만 success입니다. failure·cancelled·skipped·missing은 실패 exit code와 annotation으로 남깁니다.
- instrumentation 범위 확인이 성공하고 대상이 없으면 job 성공은 정상입니다. 해당되는 emulator 테스트를 skip하여 성공 처리하지 않습니다.
- production target은 명시적 project ID와 모든 resource binding이 일치해야 합니다. 각 공유 계약 변화는 하나의 compatibility plan과 expand→migrate→contract 순서, rollback checkpoint를 가집니다.
- Secret 원문은 manifest나 로그가 아닌 version/resource reference로만 취급합니다.

## 5. Application Use Case 상세

### 5.1 배포 후보 검증과 독립 CI

1. 배포 wrapper는 깨끗한 HEAD를 확인하고 production build·세 codebase 준비를 실행합니다. build lifecycle의 architecture 검사는 유지합니다.
2. 현재 파일의 hash와 manifest를 비교하고 명시적 production project·대상 resource·호환 계획을 검증합니다.
3. 실제 GitHub actor·Secret version metadata·Monitoring channel을 확인합니다. 전체 테스트 실행, GitHub CI 대기, CI 보고서 다운로드는 하지 않습니다.
4. main push와 PR은 CI를 시작합니다. main commit별 concurrency group을 사용하여 후속 push가 이전 commit 검증을 취소하지 않습니다.
5. `quality-summary`는 모든 job 종료 후 `needs`의 실제 결과를 요약합니다. 실패하면 GitHub check와 annotation을 남기며 기본 알림은 사용자 Actions 알림 설정을 따릅니다. repository가 별도 email·Slack을 보내지 않습니다.

### 5.2 배포 실행과 `RecordDeploymentResult`

1. manifest hash와 actor를 승인 기록에 저장합니다. CI 참조와 호환 계획은 별도로 보존합니다.
2. project의 deployment lease를 획득한 실행만 명시적 project에 Firebase CLI를 실행합니다.
3. 각 Functions predeploy는 build 후 guard를 실행합니다. guard는 전체 테스트나 build를 중복 실행하지 않고 현재 hash·actor·lease 소유자를 다시 확인합니다. Rules·Storage도 guard를 사용합니다.
4. 배포 후 authenticated 사용자 해석·가구 Query를 호출하고 반환된 releaseId·commit·artifact marker를 검사합니다.
5. smoke·실패·rollback 근거를 기록합니다. 실제 배포와 smoke가 성공한 경우에만 lease를 해제합니다. CI 결과는 배포 기록을 변경하거나 자동 rollback을 시작하지 않습니다.

### 5.3 호환 전환 예

- Google Auth: legacy candidate 포착 client → Auth/Membership/claim API+호환 Rules → 연결 관측 → server Command/Read 전환 → public/direct Rules 차단
- FID: capability 지원 SDK와 manifest metadata → endpoint dual-read/registration 관측 → Admin FID sender → legacy token writer/reader 제거

## 6. Port 설계

| 실제 경계 | 책임 |
|---|---|
| `DeploymentTargetCompatibilityInputPort` | project binding·공유 계약 호환 순서 검사 |
| `ApprovedReleaseQueryPort` | immutable 배포 승인 조회 |
| `DeploymentRecordRepositoryPort` | provenance의 기록·멱등성·충돌 |
| Firebase CLI·ADC·GitHub actor 조회 | 실제 배포·외부 resource·운영자 확인 |
| CI `needs`·step summary | 실제 다섯 job 결과를 공급하고 확인 가능한 보고서 기록 |

## 7. 저장·트랜잭션·동시성

`approvedReleases/{releaseId}`는 승인 manifest/hash와 독립 CI 참조를 보존합니다. 같은 releaseId에 다른 후보는 충돌입니다. `deploymentProvenance/{releaseId}`는 실제 배포·smoke 결과를 append-only로 보존합니다.

`deploymentLeases/{projectId}`는 한 운영 배포만 허용합니다. 성공한 smoke와 provenance 기록 뒤 해제하며 실패·중단된 실행은 잠금을 유지합니다. 자동 만료로 Cloud 작업이 겹치게 하지 않고 운영자가 기존 작업 종료를 확인한 후 복구합니다.

## 8. Event·외부 연동

CI, Firebase CLI/Admin, Emulator, GitHub, Cloud Monitoring은 외부 경계입니다. 운영 결과를 업무 Outbox와 섞지 않습니다. CI 네이티브 알림 수신 여부는 사용자 계정 설정을 따르며 저장소 코드가 수신을 보장하지 않습니다. Monitoring channel reference는 환경별 manifest 입력입니다.

## 9. 오류·보안·관측성

- 배포 오류: `CLEAN_EXACT_HEAD_REQUIRED`, `TARGET_MISMATCH`, `INCOMPATIBLE_ORDER`, `ARTIFACT_MISMATCH`, `SMOKE_FAILED` 등.
- CI 결과: success 또는 failure와 다섯 job 각각의 원래 status. 누락이나 취소를 success로 바꾸지 않습니다.
- 로그에는 Secret, Firebase credential, 가구 ID, 금융 데이터 원문을 넣지 않습니다.
- releaseId·commit·artifact와 CI run URL을 연결하여 배포와 검증의 상태를 따로 설명합니다.

## 10. 실행 패키지 구조

- [실제 배포 wrapper](../../../../../functions/scripts/deploy-firebase.mjs)
- [독립 CI 요약 CLI](../../../../../tools/ci/quality-summary.mjs)
- [품질 workflow](../../../../../.github/workflows/quality-gates.yml)
- [Firebase provenance adapter](../../../../../functions/src/adapters/firebase/operations/firebaseDeploymentProvenance.ts)

## 11. 테스트 설계

| 요구사항 ID | 수준 | 실제 테스트 대상 | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|
| REL-001 | U, I | wrapper 후보 검사·별도 CI CLI subprocess | CI 증거 없이 배포 후보 검증, CI 실패 exit code·실제 summary 파일 | T-REL-001 |
| REL-002 | U, C | project/config resolver | implicit default·mixed URL·binding 누락 거부 | T-REL-002 |
| REL-003 | U, C | compatibility checker | Auth/Rules·FID client/server 순서 위반 거부 | T-REL-003 |
| REL-004 | C, I | provenance·smoke·실제 파일 hash | 추적·redaction·실패 보존·artifact 변조 탐지 | T-REL-004 |

CI job 실행과 실제 운영 Firebase 배포는 서로 다른 외부 실행입니다. fake gh/npm 결과로 운영 배포 E2E 통과를 주장하지 않습니다.

## 12. 확정 정책과 구현 순서

[운영 실행 절차](../../../../operations/firebase-release-runbook.md)와 [manifest 예시](../../../../operations/firebase-release-manifest.example.json)를 따릅니다. [DEC-074](../../../governance/decisions.md#dec-074)가 DEC-064의 전체 CI 선행 배포 차단을 대체합니다. 실패 결과를 성공으로 위장하지 않는 원칙은 유지합니다.

인증된 Query 성공 응답의 선택적 `deployment` metadata는 releaseId·commitSha·artifactSha256를 담습니다. 이 marker JSON 자체만 artifact hash에서 제외하여 자기 참조를 피하고 실행 코드는 hash에 포함합니다. smoke는 인증·가구 Query를 확인하며 Native App Check·수집·bridge 전체 경로는 독립 CI/Emulator/E2E와 외부 설정 확인이 담당합니다.

[DEC-046](../../../governance/decisions.md#dec-046)에 따라 manifest와 provenance는 자동 TTL 없이 보존하며 Secret 원문은 제외합니다. [DEC-050](../../../governance/decisions.md#dec-050)에 따라 Cloud binding은 `household-account-6f300`만 허용하고 자동 업무 검증은 Emulator에서 수행합니다.
