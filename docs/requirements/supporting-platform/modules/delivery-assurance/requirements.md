# 배포 안전성 요구사항

> 상위 영역: 없음 — 지원·플랫폼  
> 아키텍처 역할: Delivery Assurance / Release Control  
> 지원 지도: [지원·읽기·플랫폼 요구사항 지도](../../requirements.md)  
> 상세 설계: [배포 안전성 상세 설계](design.md)

## 1. 독립 모듈 책임

이 모듈은 배포 대상·산출물·호환성·운영 권한을 검증하고 배포 결과를 기록합니다. 전체 품질 CI는 별도로 실행하며 배포 완료와 CI 통과를 구분합니다.

## 2. 포함·제외 범위

포함:

- build, unit, contract, Rules Emulator, architecture, 요구사항 추적성 gate
- 단일 production Firebase project와 로컬 Emulator의 URL·Secret·index·Rules 선택
- Web·Android·Functions·Firestore contract의 호환 배포와 rollback
- artifact provenance, 배포 전후 smoke와 경보 채널 provision 확인

제외:

- 거래·자산·알림의 업무 정책
- 테스트 시나리오의 업무 기대값
- 공급자 장애 자체의 재시도·상태 판정
- 앱 스토어·GitHub Release 배포 절차의 UI

## 3. 소유 데이터

| 논리 데이터 | Writer | 비고 |
|---|---|---|
| Release candidate manifest | CI/승인된 배포 작업 | commit, contract, Rules, index, artifact hash |
| Gate result | 각 검증 runner | immutable result와 실패 원인 |
| Deployment record | 승인된 deploy adapter | 대상 project, actor, artifact, smoke 결과 |

운영 Secret 원문과 금융 데이터는 이 모듈의 데이터가 아닙니다.

## 4. 공개 계약·의존 모듈

제공 계약:

- `verifyCandidate(manifest, projectId, dependencies)` — 배포 wrapper의 대상·HEAD·hash·호환성 검증
- `qualitySummary(needs, commitSha, runUrl)` — 독립 CI의 실제 다섯 job 결과 집계
- `ResolveDeploymentTarget(candidate)` — environment·explicitProjectId와 Firebase API·Rules·index·Secret·Monitoring binding을 한 입력으로 검증
- `VerifyCompatibilityWindow(manifest)`
- `RecordDeploymentResult(releaseId, result)`

소비 계약:

- 각 workspace의 build/test 명령
- Firestore Rules Emulator와 index validation
- contract schema compatibility checker
- Secret/config provider, Firebase project resolver, smoke runner

## 5. 요구사항

| ID | 상태 | 요구사항 | 현재 근거·예외 | 테스트 |
|---|---|---|---|---|
| REL-001 | 확정 명세 | 로컬 전체 테스트를 push 전 필수 조건으로 두지 않고 push 후 자동 CI에서 검증한다. 필요한 빠른 검증·실패 재현은 로컬에서 수행한다. main push 후 Vercel Git 자동배포와 원격 CI는 병행하며 원격 CI 완료를 배포의 선행 조건으로 두지 않는다. production build·Android 서명·대상·산출물·권한·호환성·smoke는 유지한다. main push와 PR의 CI는 Functions·Web·Web E2E·Android·해당되는 instrumentation을 검증한다. 실패 로그를 확인하여 수정·재push하고 최신 HEAD의 다섯 필수 검증 성공과 필요한 실제 배포 완료를 작업 완료 조건으로 삼는다. 실패·취소·skip·누락을 성공으로 바꾸지 않는다. | wrapper는 전체 테스트 실행·CI 대기·보고서 다운로드를 반복하지 않고 원격 CI 상태를 `not-evaluated`로 기록한다. `quality-summary`는 다섯 job 결과와 SHA·실행 링크를 summary에 기록하고 비성공이면 실패 check를 남긴다. GitHub 기본 알림은 사용자 Actions 알림 설정을 따른다. 배포 완료와 CI 성공은 별도 상태이며 production build lifecycle 검사는 유지한다. | T-REL-001, [DEC-074](../../../governance/decisions.md#dec-074) |
| REL-002 | 목표 명세 | Cloud Firebase는 기존 `household-account-6f300` 단일 프로젝트를 유지하되 배포는 production project ID를 명시적으로 선택하고 URL, Rules, index, Secret, Monitoring notification channel을 검증해야 한다. | 별도 dev·staging project는 만들지 않고 로컬 자동 검증은 Emulator에서 수행한다. `.firebaserc`의 암묵적 default나 하드코딩된 운영 스크립트만으로 대상을 승인하지 않는다. | T-REL-002, [DEC-050](../../../governance/decisions.md#dec-050) |
| REL-003 | 목표 명세 | Web·Android·Functions·Rules 중 둘 이상이 공유하는 계약 변경은 expand → 호환 client/server 배포 → migration·관측 → contract 순으로 배포하고, 구·신 버전 호환 창과 rollback 조건을 release manifest에 명시해야 한다. | Google Auth/legacy claim/Rules 전환과 FCM token→FID 전환을 부분 배포하면 기존 사용자 또는 전체 알림이 중단될 수 있다. | T-REL-003 |
| REL-004 | 목표 명세 | 운영 artifact와 배포 기록은 commit·dependency lock·contract·Rules·index hash를 추적할 수 있어야 하며, Secret 원문을 소스·artifact·로그에 포함하지 않고 배포 후 핵심 smoke와 경보 channel 연결을 검증해야 한다. | Firebase client config처럼 공개 식별자인 값과 server Secret을 구분한다. 실패한 smoke는 자동 성공으로 축약하지 않는다. release manifest와 배포 provenance에는 자동 TTL을 두지 않고 장기 보존한다. | T-REL-004, [DEC-046](../../../governance/decisions.md#dec-046) |

## 6. 정상 요구사항으로 고정하지 않을 결함

- `.firebaserc`의 단일 default project를 운영 승인으로 간주
- compile 성공만으로 Rules·계약·업무 테스트가 통과했다고 간주
- 깨진 테스트를 skip하거나 삭제해 green으로 만드는 행위
- FID client와 Admin sender, 또는 Auth client와 차단 Rules를 호환 창 없이 각각 배포
- 운영 URL·email·Secret을 소스에 하드코딩

## 7. 관련 결정·정책

- [DEC-019·020](../../../governance/decisions.md#dec-019): FID client/server 동시 전환
- [DEC-021](../../../governance/decisions.md#dec-021): 기존 사용자 무중단 Membership claim
- [DEC-018](../../../governance/decisions.md#dec-018): Monitoring 경보
- [DEC-046](../../../governance/decisions.md#dec-046): release manifest·배포 provenance 자동 TTL 없는 장기 보존
- [DEC-050](../../../governance/decisions.md#dec-050): Firebase 단일 production project 유지, 로컬 Emulator 검증과 명시적 project binding
- [DEC-074](../../../governance/decisions.md#dec-074): 배포와 전체 CI 분리; 실패를 성공으로 바꾸지 않는 원칙은 유지

## 8. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then |
|---|---|---|
| T-REL-001 | 구현 | CI 증거가 없는 정상 배포 후보 / 실제 wrapper 검증 / CI를 통과로 꾸미지 않고 후보 검증 성공. 다섯 job 중 실패·취소·누락·skip / 실제 CI 요약 CLI / 실패 exit code·annotation·commit별 summary가 기록되고 배포 상태는 변경하지 않음 |
| T-REL-002 | 목표 | project 미지정·다른 project ID·Emulator URL이 섞인 production 후보와 정상 단일 project 후보 / target resolve / 잘못된 후보는 운영 write 0건, 정상 후보만 `household-account-6f300`에 배포 |
| T-REL-003 | 목표 | FID sender만 먼저 배포하거나 public Rules를 claim client보다 먼저 차단하는 manifest / 호환 검사 / 순서 위반으로 거부 |
| T-REL-004 | 목표 | immutable artifact와 잘못된 Secret·smoke·email channel fixture / 배포 검증 / hash 추적, Secret redaction, 실패 결과 보존 |

## 9. 코드 근거

- [Firebase 설정](../../../../../firebase.json): 세 Functions codebase의 build → guard, Firestore/Storage guard 연결
- [Functions 실행 명령](../../../../../functions/package.json): 활성 test·형식·runtime boundary·architecture를 포함한 `test:quality-gate`
- [품질 CI](../../../../../.github/workflows/quality-gates.yml): Functions/Web/Android build·unit·contract·Rules/Storage/Firebase integration·Web E2E·Android instrumentation
- [배포 wrapper](../../../../../functions/scripts/deploy-firebase.mjs): clean HEAD, immutable hash, 명시적 production·actor·Secret·Monitoring 검증
- [독립 CI 결과 집계](../../../../../tools/ci/quality-summary.mjs): 실제 job 결과·SHA·실행 링크, 실패 check와 summary
- [실제 Firebase 배포 기록](../../../../../functions/src/adapters/firebase/operations/firebaseDeploymentProvenance.ts): 승인·provenance 장기 보존과 project별 배포 잠금
- [운영 실행 절차와 manifest](../../../../operations/firebase-release-runbook.md): 배포 없는 검증, 승인된 실행, 실제 서버 artifact marker smoke, 실패 복구 절차
