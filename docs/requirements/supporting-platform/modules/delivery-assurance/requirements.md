# 배포 안전성 요구사항

> 상위 영역: 없음 — 지원·플랫폼  
> 아키텍처 역할: Delivery Assurance / Release Control  
> 지원 지도: [지원·읽기·플랫폼 요구사항 지도](../../requirements.md)  
> 상세 설계: [배포 안전성 상세 설계](design.md)

## 1. 독립 모듈 책임

이 모듈은 소스·계약·Rules·index·환경 설정의 검증 결과를 하나의 배포 승인으로 묶습니다. 업무 기능의 정상 여부를 판단하지 않고, 검증되지 않은 조합이 운영 Firebase project에 배포되지 않게 합니다.

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

- `EvaluateReleaseCandidate(manifest)`
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
| REL-001 | 결함 | 운영 배포 후보는 Web·Functions·Android build, 활성 unit/contract test, Firestore Rules Emulator, 요구사항 ID·상대 링크 검사, Architecture Fitness Function을 모두 실제로 통과해야 한다. 실패·누락·skip·known failure가 하나라도 있으면 deploy authorization을 발급하지 않으며 waiver는 감사 기록일 뿐 실패를 pass로 바꾸거나 긴급 배포를 승인할 수 없다. | 현재 Web test 202개 중 9개가 실패하고 Functions 자동 test와 Rules Emulator gate·CI workflow가 없으며 Firebase predeploy는 Functions compile만 수행한다. 별도 release override Input Port는 제공하지 않고 실패 원인을 해결한 뒤 전체 필수 gate를 재실행한다. | T-REL-001, [DEC-064](../../../governance/decisions.md#dec-064) |
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
- [DEC-064](../../../governance/decisions.md#dec-064): 필수 release gate 실패는 waiver나 긴급 권한으로 우회하지 않음

## 8. 모듈 테스트 시나리오

| 테스트 ID | 종류 | Given / When / Then |
|---|---|---|
| T-REL-001 | 목표 | test 1건, Rules suite 또는 링크 검사가 실패하거나 waiver가 첨부된 후보 / 평가 / deploy command가 실행되지 않고 실패 gate와 waiver 감사 근거가 분리되어 노출됨 |
| T-REL-002 | 목표 | project 미지정·다른 project ID·Emulator URL이 섞인 production 후보와 정상 단일 project 후보 / target resolve / 잘못된 후보는 운영 write 0건, 정상 후보만 `household-account-6f300`에 배포 |
| T-REL-003 | 목표 | FID sender만 먼저 배포하거나 public Rules를 claim client보다 먼저 차단하는 manifest / 호환 검사 / 순서 위반으로 거부 |
| T-REL-004 | 목표 | immutable artifact와 잘못된 Secret·smoke·email channel fixture / 배포 검증 / hash 추적, Secret redaction, 실패 결과 보존 |

## 9. 코드 근거

- `firebase.json`: Functions predeploy가 build에만 연결됨
- `.firebaserc`: 단일 default production project
- `functions/package.json`: build 외 자동 test/lint script 부재
- `.github/workflows`: 현재 workflow 부재
- `firestore.rules`: 운영 Rules에 대한 Emulator gate 부재
- `web` test 기준선: 202개 중 193개 통과, 9개 실패
