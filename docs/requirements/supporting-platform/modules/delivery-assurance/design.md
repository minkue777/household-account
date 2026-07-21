# 배포 안전성 상세 설계

> 요구사항: [배포 안전성 요구사항](requirements.md#5-요구사항)  
> 상세 설계 규약: [모듈 상세 설계 규약](../../../governance/module-design-standard.md)  
> 목표 아키텍처: [목표 Clean Architecture 설계](../../../../architecture/target-clean-architecture.md)

## 1. 설계 목적과 추적성

`REL-001~004`를 실행 가능한 release gate와 배포 기록으로 내립니다. 이 모듈은 업무 테스트를 재정의하지 않고 각 소유 suite의 결과를 조합합니다.

## 2. 모듈 경계와 책임

- Release candidate의 모든 입력은 immutable manifest로 고정합니다.
- 환경 선택, gate 실행, compatibility plan, deployment/smoke 기록을 조정합니다.
- 실제 Firebase deploy와 각 test runner는 Output Adapter입니다.
- 업무 실패의 의미는 소유 모듈 test가 결정하며 이 모듈은 통과/실패를 바꾸지 않습니다.

## 3. 공개 계약

```ts
type Environment = 'development' | 'test' | 'production';

type RequiredReleaseGate =
  | 'web-build'
  | 'functions-build'
  | 'android-build'
  | 'active-unit-tests'
  | 'active-contract-tests'
  | 'firestore-rules-emulator'
  | 'requirement-id-trace'
  | 'relative-link-check'
  | 'architecture-fitness';

interface TestRunSummary {
  active: number;
  passed: number;
  failed: number;
  skipped: number;
  knownFailures: number;
}

interface GateEvidence {
  gate: RequiredReleaseGate;
  status: 'passed' | 'failed' | 'missing' | 'skipped' | 'known-failure';
  testRun?: TestRunSummary;
}

interface CompatibilityPlan {
  change: string;
  window: {
    oldContractVersion: string;
    newContractVersion: string;
    startsAt: string;
    endsAt: string;
    minimumSupportedClients: Readonly<Record<string, string>>;
  };
  steps: ReadonlyArray<{
    phase: 'expand' | 'migrate' | 'contract';
    capabilities: ReadonlyArray<string>;
    rollbackCheckpoint?: string;
  }>;
}

interface ReleaseCandidateManifest {
  releaseId: string;
  commitSha: string;
  environment: Environment;
  firebaseProjectId: string;
  artifacts: ReadonlyArray<{ name: string; sha256: string }>;
  contractVersion: string;
  rulesHash: string;
  indexesHash: string;
  compatibilityPlans?: ReadonlyArray<CompatibilityPlan>;
  waivers?: ReadonlyArray<{ gate: RequiredReleaseGate; scope: string; reason: string; approver: string; expiresAt: string }>;
}

type ReleaseEvaluation =
  | { kind: 'approved'; gateResults: ReadonlyArray<GateEvidence>; deployAuthorization: { releaseId: string; manifestHash: string } }
  | { kind: 'rejected'; gateResults: ReadonlyArray<GateEvidence>; failed: ReadonlyArray<{ gate: RequiredReleaseGate; code: 'GATE_FAILED' | 'GATE_MISSING' }>; waivers: ReadonlyArray<{ gate: RequiredReleaseGate; scope: string; reason: string; approver: string; expiresAt: string }> };

interface DeploymentTargetCandidate {
  environment: Environment;
  explicitProjectId?: string;
  bindings: ReadonlyArray<{
    resource: 'firebase-api' | 'rules' | 'indexes' | 'secret' | 'monitoring-channel';
    target: { kind: 'cloud-project'; projectId: string } | { kind: 'emulator'; authority: string };
  }>;
}

interface CompatibilityManifest {
  releaseId: string;
  sharedContractChanges: ReadonlyArray<string>;
  compatibilityPlans: ReadonlyArray<CompatibilityPlan>;
}
```

| Input Port | 호출자 | 결과 | 권한·멱등성 |
|---|---|---|---|
| `EvaluateReleaseCandidate` | CI | `ReleaseEvaluation` | source commit에 대한 read-only 평가, 같은 manifest hash 재생 |
| `ResolveDeploymentTarget` | CI·승인된 배포 작업 | resolved target 또는 `TARGET_MISMATCH` | explicit project와 URL·Rules·index·Secret·Monitoring binding 전체를 함께 검증 |
| `VerifyCompatibilityWindow` | CI | compatible 또는 `INCOMPATIBLE_ORDER` | 각 `sharedContractChange`에 정확히 하나의 plan을 연결하고 expand→migrate→contract 순서·rollback checkpoint 검증 |
| `RecordDeploymentResult` | post-deploy runner | recorded·replayed 또는 target/artifact mismatch | 승인된 manifest·artifact hash만 허용, `releaseId+projectId` 멱등 |

## 4. 플랫폼 모델과 불변식

- `ReleaseCandidate`는 평가가 시작된 뒤 수정할 수 없습니다.
- required gate 하나라도 missing/failed이면 `approved`가 아닙니다.
- `active-unit-tests`와 `active-contract-tests`의 `TestRunSummary`는 `active=passed`, `failed=skipped=knownFailures=0`일 때만 passed입니다. 아직 활성화하지 않은 Ready suite는 별도 진척 정보이며 active gate 집계에 섞지 않습니다.
- production target은 명시적 project ID와 environment binding이 모두 일치해야 합니다.
- compatibility 변화마다 하나의 `CompatibilityPlan`이 존재하고 `expand`, `migrate`, `contract` 단계와 rollback 가능한 checkpoint를 가집니다. plan이 없거나 한 plan을 서로 다른 변화에 암묵적으로 공유하지 않습니다.
- [DEC-064](../../../governance/decisions.md#dec-064)에 따라 gate waiver는 정상 pass가 아니며 scope·reason·approver·expiresAt을 별도 기록할 뿐 deploy authorization을 만들지 않습니다. 실패 후보를 승인으로 바꾸는 override Input Port나 capability는 존재하지 않습니다.
- Secret 값은 manifest에 넣지 않고 version/resource reference만 둡니다.

## 5. Application Use Case 상세

### 5.1 EvaluateReleaseCandidate

1. manifest schema와 artifact hash를 검증합니다.
2. 환경 binding과 Secret/Monitoring/index/Rules reference의 존재를 확인합니다.
3. build → unit → contract → Rules Emulator → architecture/docs 순으로 독립 gate를 실행합니다.
4. 공유 계약 변화가 있으면 compatibility plan과 최소 지원 version을 검사합니다.
5. 모든 결과와 waiver 감사 annotation을 분리해 저장하고 하나라도 실패하면 deploy capability를 발급하지 않습니다. waiver가 있어도 같은 rejected 결과이며, 수정 후 필수 gate 전체를 다시 평가해야 합니다.

### 5.2 배포 실행과 `RecordDeploymentResult`

1. 승인된 manifest hash와 호출자의 운영 capability를 검증합니다.
2. 명시적 `firebaseProjectId`를 deploy adapter에 전달합니다.
3. expand/migrate/contract 중 현재 phase에 허용된 artifact만 배포합니다.
4. post-deploy smoke와 Monitoring channel test를 실행합니다.
5. 결과를 `RecordDeploymentResult`로 기록합니다. 실패 시 단계별 rollback 또는 forward-fix checkpoint를 함께 보존하며 성공으로 바꾸지 않습니다.

배포 명령 자체는 승인 capability를 소비하는 운영 Adapter workflow이고 별도의 동의어 공개 계약으로 노출하지 않습니다. 공개 조회·기록 계약 이름은 상위 요구사항의 `EvaluateReleaseCandidate`, `ResolveDeploymentTarget`, `VerifyCompatibilityWindow`, `RecordDeploymentResult`로 통일합니다.

### 5.3 호환 전환 예

- Google Auth: legacy candidate 포착 client → Auth/Membership/claim API+호환 Rules → 연결 관측 → server Command/Read 전환 → public/direct Rules 차단
- FID: capability 지원 SDK와 manifest metadata → endpoint dual-read/registration 관측 → Admin FID sender → legacy token writer/reader 제거

## 6. Port 설계

| Port | 책임 |
|---|---|
| `GateRunnerPort` | 이름·명령·결과·artifact를 구조화해 실행 |
| `ProjectBindingPort` | environment와 허용 Firebase project 검증 |
| `SecretReferencePort` | Secret 존재·version만 확인하고 원문 비노출 |
| `CompatibilityCheckerPort` | schema/Rules/client 지원 범위 검사 |
| `DeploymentPort` | 명시적 project에 immutable artifact 배포 |
| `SmokeTestPort` | 인증·query·Rules·notification/alert 최소 흐름 검증 |
| `ReleaseRecordRepository` | manifest, gate, deployment, waiver append |

## 7. 저장·트랜잭션·동시성

- `releaseId`와 manifest hash가 다르면 `Conflict(RELEASE_ID_REUSED)`입니다.
- 같은 artifact를 같은 project에 중복 배포하면 저장된 결과를 재생합니다.
- 배포 lease로 같은 project의 겹치는 production 배포를 막습니다.
- gate와 deploy record는 append-only이며 오류 원문 대신 redacted code·artifact link를 저장합니다.

## 8. Event·외부 연동

- CI, Firebase CLI/Admin, Emulator, artifact registry, Cloud Monitoring은 모두 Adapter입니다.
- `ReleaseApproved`, `DeploymentStarted`, `DeploymentCompleted`, `DeploymentFailed`는 운영 Event이며 업무 Outbox Event와 저장소를 섞지 않습니다.
- Monitoring 이메일 주소는 소스가 아니라 환경별 notification channel resource reference로 주입합니다.

## 9. 오류·보안·관측성

- 오류: `GATE_FAILED`, `GATE_MISSING`, `TARGET_MISMATCH`, `INCOMPATIBLE_ORDER`, `ARTIFACT_MISMATCH`, `SMOKE_FAILED`.
- log에는 Secret, Firebase credential, 가구 ID, 금융 fixture 원문을 포함하지 않습니다.
- releaseId, commit, project alias, gate duration, failure code, rollback result를 관측합니다.

## 10. 목표 패키지 구조

```text
tools/release/
  application/
  domain/
  adapters/
contracts/compatibility/
.github/workflows/
firebase/
  environments/
  indexes/
  rules/
```

특정 CI 공급자에 Domain 판단을 넣지 않고 작은 검증 CLI와 manifest schema를 workflow가 호출합니다.

## 11. 테스트 설계

| 요구사항 ID | 수준 | 테스트 대상 | 핵심 fixture | 관찰 결과 | Canonical 테스트 ID |
|---|---|---|---|---|---|
| REL-001 | U, C, I | gate aggregator | pass, failed, missing, skipped, known failure, waiver | 하나라도 비통과면 waiver와 무관하게 deploy 0회 | T-REL-001 |
| REL-002 | U, C | project/config resolver | implicit default, mixed URL, missing index/channel | production target 거부 | T-REL-002 |
| REL-003 | U, C | compatibility checker | Auth/Rules, FID client/server 순서 | unsafe partial deploy 거부 | T-REL-003 |
| REL-004 | C, I | provenance·smoke | hash mismatch, Secret leak, smoke failure | 추적·redaction·실패 보존 | T-REL-004 |

## 12. 확정 정책과 구현 순서

[DEC-046](../../../governance/decisions.md#dec-046)에 따라 release manifest와 artifact·contract·Rules·index hash, 배포 대상·smoke·rollback provenance는 자동 TTL 없이 장기 보존합니다. Secret 원문은 보존 대상에 포함하지 않습니다. [DEC-050](../../../governance/decisions.md#dec-050)에 따라 Cloud binding은 `household-account-6f300` 하나만 허용하고 자동 검증은 Emulator를 사용합니다. `ProjectBindingPort`는 단일 project라도 누락·불일치·암묵적 default를 거부합니다. [DEC-064](../../../governance/decisions.md#dec-064)에 따라 waiver는 감사 기록으로만 보존하고 필수 gate 실패를 승인으로 바꾸는 긴급 override 경로는 구현하지 않습니다.

구현 순서:

1. 현재 실행 명령과 실패 Web suite를 release manifest 밖에서 먼저 정리합니다.
2. 문서 ID/link, build, unit/contract gate를 read-only CI로 연결합니다.
3. Rules Emulator와 architecture boundary test를 추가합니다.
4. Firebase Emulator에서 Rules·index·contract와 smoke fixture를 검증합니다.
5. Auth/Rules와 FID 호환 계획을 통과하고 `household-account-6f300`을 명시한 후보에만 production deploy를 엽니다.
