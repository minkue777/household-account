# Functions 계약 테스트

이 디렉터리는 현재 Functions 구현을 보존하는 회귀 테스트가 아니라, 요구사항과 상세 설계가 정한 목표 계약을 실행 가능한 형태로 고정합니다.

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

## 참고 구현 테스트의 의미

`test/reference`의 Android Host·PWA TypeScript 구현은 상세 설계를 실행 가능한 형태로 표현한
참고 모델입니다. 실제 Kotlin Activity, Android WebView, 브라우저 Service Worker 또는 Firebase
Messaging을 실행하지 않으므로 Android·PWA 제품 구현 통과 수로 보고하지 않습니다.

참고 모델의 계약 통과와 제품 동작 검증은 다음과 같이 분리합니다.

1. 참고 모델 계약: 요구사항과 상태 전이의 내부 일관성
2. 실제 Adapter·callable 통합: Auth, wire, Functions, Firestore 연결
3. Web Playwright E2E: 실제 Chromium에서 로그인부터 화면 반영까지
4. Android instrumentation: 실제 Activity, WebView, Quick Edit 표시

릴리스 근거에는 해당 기능의 참고 모델 테스트만 제시할 수 없으며, 대응하는 실제 런타임
통합 또는 E2E 결과를 함께 제시해야 합니다.

## 현재 검증 상태

실행 개수와 결과는 [전수 감사 수정 상태](../../docs/verification/full-audit-remediation.md)와 CI의 실제 JSON/XML 보고서를 사용합니다. 요구사항·Canonical 테스트 ID 선언 개수는 [자동 카탈로그](../../docs/requirements/catalog-summary.md)에서 별도로 집계합니다.

교체 전 PWA 특성화 파일은 Subject가 연결되지 않은 비활성 placeholder였으므로 제거했습니다. 열린 입력·controller 보존은 활성 [worker 계약](contexts/supporting-platform/pwa/worker-update-session-isolation.contract.test.ts)과 [실제 production browser E2E](../../web/e2e-pwa/production-runtime.spec.ts)가 검증합니다.

## 목표 구현 연결

현재 문서화된 목표 계약의 구현 연결은 완료됐습니다. 다음 절차는 새 계약을 추가하거나 기존 계약을 변경할 때 적용합니다.

1. 해당 기능의 `public.ts`에 문서와 같은 Input Port와 typed Result를 구현합니다.
2. 테스트 파일의 `createSubject()`만 production composition 또는 In-memory adapter에 연결합니다.
3. 구현 전 명세를 `describe.skip`으로 작성했다면 구현 연결과 함께 `describe`로 바꿉니다.
4. assertion이 실패하면 현재 구현에 맞춰 기대값을 바꾸지 않고, 요구사항·DEC·상세 설계의 충돌 여부부터 확인합니다.
5. Repository는 같은 Conformance Suite를 In-memory Fake와 Firestore Emulator Adapter에 각각 실행합니다.

`createSubject()`의 fixture·fault injection·상태 조회 함수는 테스트 driver입니다. 제품 공개 API가 아니며 production `public.ts`로 내보내지 않습니다.

테스트는 공개 Result, Read Model, 최종 Canonical 상태와 공개 Event만 검증합니다. Firestore 경로, Firebase SDK 호출 순서, private class, 함수 분해 방식은 계약으로 고정하지 않습니다.

## 추적성 완료의 의미

모든 요구사항이 Canonical 테스트와 연결되고 모든 테스트 본문이 존재하더라도 목표 계약이 `describe.skip` 상태라면 구현 검증은 완료된 것이 아닙니다. 실행되지 않은 과거 placeholder를 합격 기준으로 유지하지 않습니다. 추적성 gate는 누락 없는 테스트 명세를 보장하고, release 통과 여부는 목표 Input Port에 연결되어 실제로 실행되는 active 테스트만으로 판단합니다.
