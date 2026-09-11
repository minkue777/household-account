---
name: household-delivery
description: Household-account 프로젝트에서 기능 개발, 버그 수정, 최적화, 테스트·설정 변경을 요청받으면 구현부터 commit·push, 변경된 Web/Firebase/Android 배포, GitHub CI 실패 분석·수정·재push까지 이어서 수행한다. 별도의 배포 요청을 기다리지 않는다. 설명·읽기 전용 조사만 요청했거나 사용자가 commit·push·배포를 제외하면 그 범위를 따른다.
---

# 개발 변경 전달과 CI 확인

이 저장소의 개발 작업은 필요한 변경을 구현하고 원격 반영·대상별 배포·CI 결과 확인까지 이어간다. 사용자는 이 기본 흐름을 승인했다. 이미 승인된 일반 commit·push·배포를 단계마다 재확인하지 않는다. 현재 요청의 보류·범위 제한이 우선이며, 다른 저장소나 운영 데이터 migration·삭제까지 허용한 것으로 확대하지 않는다.

저장소 루트는 이 파일에서 `../../..`이며, GitHub 저장소는 `minkue777/household-account`, 배포 브랜치는 `main`이다. AGENTS.md에는 이 절차를 복제하지 않는다.

## 1. 변경과 배포 범위 결정

- 요구사항·계약을 확인해 구현한다. `git status`, diff, 원격 브랜치와 이전 배포 기록을 읽어 현재 작업의 변경을 구분한다. 다른 작업자의 수정은 보존한다.
- 아직 push하지 않은 제품 변경과 이전 배포에서 남은 대상을 함께 확인한다. 최신 CI 수정 커밋이 테스트만 바꿨다는 이유로 앞선 미배포 제품 변경을 놓치지 않는다.
- 아래 표로 배포 대상을 정한다. 공용 계약·의존성 변경은 실제 빌드에 포함되는 대상을 확인한다. 테스트·문서만 바뀐 경우 Firebase나 APK를 새로 배포하지 않는다.

| 변경 대상 | 실행할 배포 |
|---|---|
| Web 실행 코드·자산·빌드 설정 | 기존 Vercel Git 자동배포 |
| Functions 실행 코드·서버 의존성·공용 서버 계약, Firestore Rules/index, Storage Rules | Firebase 운영 배포 |
| Android 실행 코드·리소스·릴리즈 빌드 설정·APK에 포함되는 계약 | 서명 APK와 GitHub Release |
| 테스트·CI·문서·스킬만 변경 | push와 CI 확인; 기존 Vercel Git 트리거는 유지 |

- 서버와 클라이언트 변경은 기존 운영 버전과 호환되게 배치한다. 새 서버가 클라이언트보다 먼저 필요한 경우, 해당 서버 후보를 commit한 뒤 Firebase 선행 배포를 완료하고 Web 자동배포를 유발하는 push 또는 APK 공개를 진행한다. 단순 변경에 별도 전환 절차를 만들지 않는다.
- APK가 필요하면 아래 APK 스킬로 버전과 빌드를 먼저 준비해 한 작업의 commit·push에 포함한다. CI 수정만으로 버전을 다시 올리지 않는다.

## 2. commit·push

- 로컬에서 전체 CI를 반복 실행하거나 모든 로컬 테스트가 끝날 때까지 push를 대기시키지 않는다. 구현 오류를 확인하는 짧은 검사와 실패 원인 재현은 필요한 범위에서 실행한다. 이미 확인한 결함을 고치지 않은 채 완료로 보고하지 않는다.
- 변경 내용을 검토하고 필요한 파일만 명시적으로 stage한다. 한국어 commit 메시지를 작성하고 `git push origin main`으로 반영한다. 원격 선행 변경이 있으면 보존하며 통합하고, force push하지 않는다.
- 비밀키·토큰·Android 서명 파일은 Git에 포함하지 않는다. 기존 hook이나 검증 코드를 끄는 방법으로 실행 오류를 우회하지 않는다.
- push한 40자리 SHA를 기록한다. `main`이 아닌 브랜치나 원격 대상이 다른 상황은 실제 작업 범위를 확인해 처리하며 임의로 다른 작업 브랜치를 배포하지 않는다.

## 3. 변경된 대상 배포

원격 CI와 배포는 병행한다. CI 완료를 배포의 사전 조건으로 다시 추가하지 않는다. 각 대상의 실제 production build와 배포 검증은 수행한다.

CI에서 실제 제품 결함이 이미 확인되었다면 그 원인을 먼저 수정한 후보를 배포한다. 테스트 관측·fixture·실행 환경 실패와 구분하며, 이 판단을 전체 CI 완료 대기로 바꾸지 않는다.

### Web

- 기존 `main push → Vercel Git 자동배포` 연결을 유지한다. CI 대기 설정이나 별도 CLI 업로드 경로로 바꾸지 않는다.
- 해당 SHA의 GitHub deployment/status 또는 Vercel 배포 상태와 운영 URL을 확인한다. 다른 SHA의 Ready를 이번 배포 성공으로 간주하지 않는다.
- 작업 디렉터리를 `vercel deploy`로 직접 업로드하지 않는다. Git 무시 파일과 Android 서명 파일이 업로드된 과거 문제가 있다.

### Firebase

- 이 대상이 필요할 때만 [Firebase runbook](../../../docs/operations/firebase-release-runbook.md)을 읽는다. Functions는 `default`, `payment-capture`, `access-session` 세 codebase이며 운영 project는 `household-account-6f300`이다.
- runbook의 `npm --prefix functions run deploy -- ...` wrapper를 사용한다. build·clean HEAD/hash·호환성·actor·Secret binding·lease·실제 로그인 smoke를 유지하고 직접 `firebase deploy`로 우회하지 않는다.
- 운영 데이터나 Secret 값을 로그로 가져오지 않는다. 유효한 인증·smoke 자격이 있으면 재사용하고, 실제 사용자 로그인이 필요한 때만 그 조작을 요청한다. 대기 중 독립적인 push·Web·CI 작업은 진행한다.

### Android APK

- 이 대상이 필요할 때만 기존 [github-release-deploy 스킬](../../../.codex/skills/github-release-deploy/SKILL.md)을 읽는다. 버전 준비·서명 build·Release 업로드 절차를 재사용하고 이미 수행한 commit·push나 버전 증가를 반복하지 않는다.
- 실제 서명을 검증하고 배포 SHA를 Release의 `--target`으로 지정한다. CI의 `assembleRelease` 성공이나 unsigned artifact는 서명 APK 공개 성공이 아니다.
- 이미 공개된 버전은 덮어쓰지 않는다. APK 내용에 후속 수정이 필요할 때 새 patch 버전을 준비한다.
- 최종 asset URL과 다운로드 가능 여부를 확인한다. 사용자가 카카오톡에 복사할 수 있도록 APK 주소는 일반 텍스트 URL로 제공한다.

## 4. CI 결과 확인과 실패 수정

워크플로는 `.github/workflows/quality-gates.yml` 하나이며 검사 job은 `functions`, `web`, `web-e2e`, `android`, `android-instrumentation` 다섯 개다. `quality-summary`는 결과 요약이며 여섯 번째 테스트 묶음이 아니다. Android instrumentation은 기존 변경 범위 판정을 유지하며 Web 화면 수정만으로 에뮬레이터를 의무화하지 않는다.

push 직후 다음처럼 해당 SHA의 실행을 찾는다. 아래의 SHA·RUN_ID는 실제 조회한 값으로 대체한다.

```text
gh run list --repo minkue777/household-account --workflow quality-gates.yml --commit SHA --event push --limit 10 --json databaseId,headSha,status,conclusion,url
gh run view RUN_ID --repo minkue777/household-account --json headSha,status,conclusion,jobs,url
gh run view RUN_ID --repo minkue777/household-account --log-failed
```

- 실행이 아직 생성되지 않았으면 잠시 후 다시 조회한다. 활성 세션에서 30~60초 간격으로 확인하면서 배포·검토 등 독립 작업을 진행하고, 사용자가 상태를 알 수 있게 갱신한다.
- 실패한 job을 발견하면 가능한 즉시 로그를 읽는다. 전체 실행 종료 전 로그가 제공되지 않으면 조회 가능한 job 로그·artifact를 확인하고 완료 후 재확인한다.
- 코드 결함, 테스트 관측/fixture 오류, 실행 환경·인증 오류를 구분해 원인을 수정한다. 테스트를 skip하거나 기대값·검증 범위를 약하게 만들어 초록색으로 바꾸지 않는다. 같은 원인의 무변경 재실행을 반복하지 않는다.
- 실패 항목의 빠른 재현 검사를 실행할 수 있으면 확인하고 수정 commit을 push한다. 새 SHA의 CI를 다시 추적하고 제품 변경이 있는 대상만 재배포한다. 이전 실패 실행은 성공 기록으로 덮어쓰지 않는다.
- 마지막 배포 후보 SHA의 workflow와 다섯 검사 job이 모두 성공해야 검증 완료다. pending·누락·취소·job 전체 skipped를 성공으로 보고하지 않는다. Android 범위 미해당으로 job이 성공하고 에뮬레이터 step만 생략된 경우는 정상이다.
- 인증·권한·서비스 장애 등 스스로 해결할 수 없는 원인이면 실패 로그와 실행 URL, 필요한 사용자 조작을 구체적으로 보고한다. 영향 없는 작업은 완료하고 남은 검증을 완료라고 표현하지 않는다.

## 5. 완료와 재개

최종 답변은 push SHA, 대상별 실제 배포 상태와 URL, 해당 SHA의 CI 결과·실행 링크를 구분한다. CI가 실패하거나 필요한 배포가 남아 있으면 전체 완료라고 하지 않는다. 네이버 메일 등 GitHub 개인 알림은 보조 수단이며 메일 도착 여부를 CI 결과로 사용하지 않는다.

이 스킬은 현재 작업 중인 에이전트가 절차를 수행하는 지침이다. 자체적으로 GitHub 이벤트를 구독하거나 종료된 대화를 깨우지 않는다. 세션이 중단되면 다음 실행에서 기록된 SHA와 원격 상태를 다시 확인한다. 별도 예약·이벤트 자동화가 실제 설정되지 않았다면 상시 감시나 자동 재개가 설치됐다고 말하지 않는다.
