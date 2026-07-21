# Functions 계약 테스트

이 디렉터리는 현재 Functions 구현을 보존하는 회귀 테스트가 아니라, 요구사항과 상세 설계가 정한 목표 계약을 실행 가능한 형태로 고정합니다.

## 실행

```powershell
npm test
npm run test:contract
npm run test:architecture
npm run test:types
```

- `test/contracts`: 둘 이상의 런타임이 공유할 wire schema·fixture와 운영 manifest를 검증하는 active suite
- `test/contexts`: 기능 모듈의 Domain·Application 공개 행위를 검증하는 suite
- `test/architecture`: 요구사항 ID → Canonical 테스트 ID → 테스트 소스 연결, 중복 소유, 미작성 표, 구현 결합, 문서 상대 링크를 검사하는 active gate
- `describe.skip`: 실행·release 근거에서 명시적으로 제외한 suite. 제품 동작 중 의도적으로 제외한 것은 교체 전 PWA 특성화 1개뿐이며, 통합 테스트는 Emulator 환경 변수가 없을 때만 조건부 skip됩니다.
- `test.todo`: 제품 결정이 남아 결과를 고정할 수 없는 단일 시나리오. 현재는 없습니다.

skip과 todo는 통과가 아닙니다. 결과 보고에는 active·skip·todo 개수를 함께 적습니다.

## 현재 상태

2026-07-21 실측 결과입니다. 모든 목표 Context 계약은 실제 Domain/Application 공개 계약에 연결된 Implemented 상태입니다. 일반 `npm test`는 2,299개를 통과하고 Emulator 전용 46개를 환경 조건으로 건너뜁니다. 전용 Emulator 명령에서 이 46개도 모두 통과하므로 활성 release 근거는 총 2,345개입니다.

| 실행 경계 | 활성 파일 | 통과 시나리오 | skip 파일 / 시나리오 |
|---|---:|---:|---:|
| Access & Household | 13 | 145 | 0 / 0 |
| Household Finance | 33 | 250 | 0 / 0 |
| Notifications | 12 | 108 | 0 / 0 |
| Payment Capture | 39 | 579 | 0 / 0 |
| Portfolio | 34 | 245 | 0 / 0 |
| Android Host | 17 | 186 | 0 / 0 |
| Delivery Assurance | 3 | 87 | 0 / 0 |
| External Operations | 9 | 104 | 0 / 0 |
| Home Preferences | 6 | 48 | 0 / 0 |
| PWA | 8 | 287 | 1 / 1 |
| Reporting | 10 | 54 | 0 / 0 |
| 공통 시스템 계약 | 5 | 45 | 0 / 0 |
| 공유 wire·운영 계약 | 10 | 35 | 0 / 0 |
| Architecture Fitness Function | 9 | 33 | 0 / 0 |
| Adapter·bootstrap·read-side 단위 계약 | 33 | 93 | 0 / 0 |
| Emulator 전용 통합 | 12 | 46 | 일반 실행에서 12 / 46, 전용 실행에서 0 / 0 |
| 합계 | 253 | 2,345 | 의도적 legacy 1 / 1 |

목표 Context의 Implemented 범위는 189개 파일·2,138개 시나리오입니다. 유일한 비활성 제품 외 테스트는 [교체 전 PWA `skipWaiting` 동작 특성화](contexts/supporting-platform/pwa/legacy-worker-activation-characterization.contract.test.ts) 1개입니다. 목표 동작은 활성 PWA update 계약이 검증하므로 이 파일은 구현 대기 상태가 아니라 의도적으로 보존한 이력이며 release 통과 근거에는 포함하지 않습니다. `test.todo`는 없습니다.

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

모든 요구사항이 Canonical 테스트와 연결되고 모든 테스트 본문이 존재하더라도 목표 계약이 `describe.skip` 상태라면 구현 검증은 완료된 것이 아닙니다. 현재 목표 계약에는 skip이 없으며, 남은 PWA legacy characterization은 목표 합격 기준이 아닙니다. 추적성 gate는 누락 없는 테스트 명세를 보장하고, release 통과 여부는 목표 Input Port에 연결되어 실제로 실행되는 active 테스트만으로 판단합니다.
