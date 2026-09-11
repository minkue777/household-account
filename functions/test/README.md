# Functions 계약 테스트

이 디렉터리는 요구사항과 상세 설계의 계약을 실제 Functions 구현, 공용 wire schema, Firebase Emulator에 연결해 검증합니다. 요구사항을 복제한 테스트 전용 업무 구현은 합격 근거로 사용하지 않습니다.

## 실행

```powershell
npm test
npm run test:contract
npm run test:architecture
npm run test:types
npm run test:callable-integration
```

- `test/contracts`: 둘 이상의 런타임이 공유할 wire schema·fixture와 운영 manifest를 검증하는 active suite
- `test/contexts`: 기능 모듈의 Domain·Application 공개 행위를 검증하는 suite
- `test/architecture`: 요구사항 ID → Canonical 테스트 ID → 테스트 소스 연결, 중복 소유, 미작성 표, 구현 결합, 문서 상대 링크를 검사하는 active gate
- `test/integration/callable`: 실제 Auth 토큰과 callable HTTP wire를 거쳐 Functions Emulator와 Firestore Emulator까지 연결하는 수직 통합 suite
- Emulator 통합 테스트는 해당 Emulator 환경 변수가 없을 때만 조건부 skip되며 별도 실행 결과가 필요합니다. 활성 계약의 skip은 release 통과 근거가 아닙니다.
- `test.todo`: 제품 결정이 남아 결과를 고정할 수 없는 단일 시나리오. 현재는 없습니다.

skip과 todo는 통과가 아닙니다. 결과 보고에는 active·skip·todo 개수를 함께 적습니다.

## 실제 구현 연결

Android Host·PWA의 `test/reference`와 이를 검증하던 계약 테스트, 메모리 배열에 암호화 방식 문자열만 붙인 Quick Edit outbox 모델, 별도 FID logout 모델은 삭제했습니다. 삭제 근거와 대체 검증은 [실제 코드 테스트 정리](../../docs/testing/real-code-test-cleanup.md)에 기록합니다.

1. Functions Adapter·callable 통합은 Auth, wire, Functions, Firestore를 연결합니다.
2. Web Playwright E2E는 실제 브라우저에서 입력부터 저장 및 화면 반영까지 연결합니다.
3. Android JVM/instrumentation은 실제 Kotlin 로직·Activity·WebView·Keystore·Worker를 실행합니다.
4. Android Firebase E2E는 별도 Emulator 전용 runner로 수집→Quick Edit→서버 저장을 연결합니다. 서버나 fixture가 없으면 실패하며 기본 instrumentation의 조건부 skip으로 처리하지 않습니다.

외부 SDK·네트워크를 대역으로 교체한 단위 테스트도 실제 운영 로직의 결과를 검증하면 유지합니다. 운영 코드를 가져오지 않고 재작성한 업무 모델만 실행하는 테스트는 추가하지 않습니다.

## 현재 검증 상태

실행 개수와 결과는 [전수 감사 수정 상태](../../docs/verification/full-audit-remediation.md)와 CI의 실제 JSON/XML 보고서를 사용합니다. 요구사항·Canonical 테스트 ID 선언 개수는 [자동 카탈로그](../../docs/requirements/catalog-summary.md)에서 별도로 집계합니다.

PWA 검증은 [실제 production worker handler](../../web/src/__tests__/platform/pwaWorkerNotification.test.ts)와 [실제 production browser E2E](../../web/e2e-pwa/production-runtime.spec.ts)를 사용합니다. 별도 참고 worker의 합격을 배포된 worker의 검증으로 계산하지 않습니다.

## 새 테스트의 구현 연결

다음 절차는 새 계약을 추가하거나 기존 계약을 변경할 때 적용합니다. 아직 실행 검증이 없는 요구사항은 그 공백을 명시하고, ID 선언만으로 구현 검증 완료로 계산하지 않습니다.

1. 배포 entry, 실제 Web 화면, Android Activity/Service에서 실행되는 코드를 먼저 확인합니다. `src` 폴더나 `public.ts`에 있다는 사실만으로 운영 구현으로 간주하지 않습니다.
2. 사용자 기능은 브라우저/앱 입력부터 실제 Auth·callable·저장·재조회까지 E2E로 연결합니다. Scheduler와 운영 도구는 실제 export 또는 CLI를 실행합니다.
3. 단위 테스트는 그 경로가 실제로 사용하는 policy·component·adapter를 실행합니다. 외부 네트워크·시간·SDK port 대역은 허용하지만 업무 처리 자체를 테스트용 Application으로 재작성하지 않습니다.
4. assertion 실패 시 잘못된 fixture·selector·동기화인지 실제 요구사항 위반인지 구분합니다. 실제 요구사항 위반을 현재 결과에 맞춰 통과시키지 않습니다.
5. Repository의 메모리 adapter만으로 저장 동시성·원자성을 보장했다고 주장하지 않습니다. 실제 Firebase Emulator 검증을 함께 실행합니다.

`createSubject()`의 fixture·fault injection·상태 조회 함수는 테스트 driver입니다. 제품 공개 API가 아니며 production `public.ts`로 내보내지 않습니다.

테스트는 공개 Result, Read Model, 최종 Canonical 상태와 공개 Event만 검증합니다. Firestore 경로, Firebase SDK 호출 순서, private class, 함수 분해 방식은 계약으로 고정하지 않습니다.

## 추적성 완료의 의미

추적성 gate는 주석이나 fixture의 ID가 아니라 실제 테스트 선언과 Native 파일::메서드 연결을 검사합니다. [E2E 연결표](../../docs/testing/e2e-requirement-coverage.md)는 선언 기준이며 통과율이 아닙니다. 실제 Playwright JSON과 Kotlin JUnit 결과가 필요하고, 각 영역 문서에 외부 공급자·실기기·운영 배포 경계를 명시합니다. 새 요구사항에 E2E 또는 근거 있는 운영/폐기 예외가 없으면 gate가 실패합니다.
