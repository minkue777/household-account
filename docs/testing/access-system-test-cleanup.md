# Access·공통 시스템 테스트 감사 — 2026-09-11

다음 5개 계약과 전용 support 5개를 삭제했습니다. 각 Application factory는 실제 bootstrap·Web·Android·CLI에서 호출되지 않고 테스트 driver에서만 사용됐습니다. `src`에 있어도 현재 배포 코드를 검증하지 못하는 대리 구현이었습니다.

| 삭제 테스트 | 테스트 전용 factory | 실제 대체 |
|---|---|---|
| `household-guard.contract.test.ts` | `createHouseholdGuardApplication` | 실제 `access-household` E2E의 미인증 진입·legacy 전환·타 가구 차단, 실제 Firestore Rules |
| `session-membership-retention.contract.test.ts` | `createSessionMembershipApplication` | 실제 로그아웃/재로그인 UI·Member ID 보존, 실제 Auth·SessionScope 단위 검증, Native mirror와 endpoint E2E |
| `unauthenticated-ingress.contract.test.ts` | `createProtectedIngressApplication` | `system-commands`·알림·Shortcut의 실제 HTTP 무인증/위조 거절. 외부 Play Integrity attestation 성공은 자동 E2E 범위와 구분 |
| `unit-of-work-integrity.contract.test.ts` | `createAtomicCommandApplication` | `system-commands`의 실제 동시 Command→거래/receipt/Outbox·동일 요청 재생·payload 충돌, 기존 Firebase Repository/UoW 통합 |
| `migration-runner.contract.test.ts` | `createMigrationRunnerApplication` | `operations-cli`의 실제 배포 migration CLI→Emulator dry-run/승인/범위/page 재개/reconciliation |

동일 검색에서 후보였던 `createReleaseCandidateEvaluationApplication`, `createDeploymentTargetCompatibilityApplication`, `createDeploymentProvenanceApplication`은 `functions/scripts/deploy-firebase.mjs`가 동적으로 가져와 실제 사용하는 코드입니다. 관련 실제 evaluator·CLI·adapter 검증은 보존했습니다. 단순히 bootstrap에서 문자열을 찾지 못했다는 이유로 삭제하지 않았습니다.

Web에서는 CSS 클래스·소스 문자열의 존재만 확인하던 긴 가맹점 레이아웃, 즉시 반응 UI, 자체 호스팅 글꼴, Native resume 변수 발생 횟수, AppDialog Provider 문자열 테스트를 제거했습니다. 실제 브라우저 geometry/hit-test·저장 흐름·글꼴 로딩, 실제 Read Model·AppDialog component 테스트가 이를 대신합니다. 금지 API·import 방향 등 정적 분석 자체가 목적에 맞는 아키텍처 검사는 보존했습니다.

Firebase 통합 14개 파일/75개 검증은 실제 Emulator에서 실행했습니다. 여러 파일의 동시 실행 때 한 transaction 경합 결과가 일시적인 `retryable-failure`였고, 해당 동시성 테스트 단독 실행 및 전체 파일 직렬 실행에서 모두 통과했습니다. 단일 Emulator의 자원 경합을 줄이도록 공식 `test:firebase-integration`은 파일 간 직렬 실행으로 설정했습니다. 한 테스트 안의 동시 Command/transaction 검증은 그대로 유지합니다.

최종 실행 결과가 이 기록보다 우선합니다. 새 E2E의 존재를 실행 통과로 계산하지 않습니다.
