# Capture 입력 helper 계약 정비

기준 SHA는 `921ef881ccd84641aa711416cde7f31bfddbfabb`입니다. 아래 두 helper와 두 직접 소비 테스트의 전체 본문을 검토했습니다. 제품 실행 코드 변경은 없습니다.

## 입력·결과·실패·저장 계약

- `capture-submission-command.ts`는 테스트가 지정한 root key·채널·결제 금액·가맹점·카드·선택 잔액으로 공개 `CaptureSubmissionCommand` 입력만 만듭니다. actor, 원 관찰 시각, parser/source evidence, hash의 기본값을 보존합니다. 저장하거나 기대 원장 결과를 계산하지 않습니다.
- `capture-branch-envelopes.ts`는 잔액 단독 입력과 거래·잔액 동시 입력을 제공합니다. 서로 다른 root/branch/observation identity 및 잔액 관찰값을 그대로 유지합니다. 두 입력은 조율 테스트의 정적 자료이며 실제 Gateway의 카드 검증·취소 판정까지 흉내 내지 않습니다.
- 실제 조율 계약 6건은 capability 없는 요청의 무변경 거부, Android 승인 단독 경로의 외부 receipt 생략, 잔액 단독 actor/원 관찰값 전달, 거래 거부와 잔액 성공의 독립성, 거래/잔액 각각 실패 시 해당 branch만 재호출, 충돌 payload의 무변경 거부와 terminal 재생을 확인합니다.
- 실제 SDK 통합 검사 5건은 동일 root 동시 제출과 payload 경합, 채널·카드가 달라도 공통 fingerprint로 거래 한 건 수렴, 없는 취소 뒤 승인·성공 취소 tombstone/receipt 재생, 잔액 실패 뒤 성공과 원장·잔액 version·Outbox 보존을 확인합니다. 실제 `CaptureSubmissionApplication → CaptureBranchSubmissionApplication → Gateway → Firebase` 경로를 그대로 사용합니다.

## 변경과 유지 이유

승인 입력을 만든 뒤 command/envelope/paymentObservation을 다시 복사하던 `cancellationCommand`를 제거했습니다. `paymentCommand`가 실제 공개 `CapturePaymentObservation["observationType"]`을 받아 승인(기본값) 또는 취소 입력을 직접 만듭니다. helper 자신이 반드시 생성한 결제 관찰값을 다시 검사하던 불가능한 실패 분기와 오류도 사라집니다. 두 취소 소비 지점에서는 채널·취소 종류를 직접 읽을 수 있습니다.

카드·잔액·채널 타입을 각각 공개 `CapturePaymentObservation`, `CaptureBalanceObservation`, `CaptureOriginChannel`에서 가져옵니다. 사용하지 않던 observationId 덮어쓰기 옵션을 제거했으며, 실제 모든 호출자의 observation/branch ID는 여전히 root key에서 동일하게 만들어집니다.

정적 envelope 두 개의 구조와 값은 유지했습니다. 이를 범용 builder로 바꾸면 입력 몇 개를 만들기 위해 별도 조건과 API를 추가하게 되므로 이득이 없습니다. `satisfies CaptureBranchEnvelope`로 공개 계약 검사를 유지하면서 실제 존재하는 branch 타입도 보존하여 helper와 소비자의 non-null assertion 4개만 제거했습니다.

테스트의 실제 application·운영 해셔·명시적 downstream Spy·실제 SDK 구성은 유지했습니다. 가짜 원장·취소·잔액 계산 모형을 추가하지 않았으며 assertion과 요구사항 ID를 삭제하거나 완화하지 않았습니다.

## 전체 파일 줄 수

줄 수는 기준 SHA의 전체 파일과 작업 결과의 전체 파일을 같은 방식으로 집계했습니다. 테스트 보조 코드이므로 제품 실행 코드 감소로 합산하지 않습니다.

| 범위 | 이전 | 이후 | 변화 |
|---|---:|---:|---:|
| `functions/test/support/capture-branch-envelopes.ts` | 49 | 49 | 0 |
| `functions/test/support/capture-submission-command.ts` | 97 | 72 | -25 |
| helper 합계 | 146 | 121 | -25 (17.1%) |
| `functions/test/contexts/payment-capture/android-payment-ingestion/capture-submission-receipt.contract.test.ts` | 83 | 83 | 0 |
| `functions/test/integration/firebase/capture-financial-flow.integration.test.ts` | 123 | 131 | +8 |
| 직접 소비 테스트 합계 | 206 | 214 | +8 |

제품 실행 코드 증감은 0줄이며, 테스트 helper와 직접 소비 테스트를 합친 순감소는 17줄입니다. 신규 문서는 이 집계에서 제외합니다. 취소 입력의 명시적 인자 때문에 늘어난 테스트 8줄을 감추거나 압축하지 않았습니다.

## 검토 참조 경로

- 전체 본문: 위 helper 2개와 직접 소비 테스트 2개.
- 공개 입력 타입: `functions/src/contexts/payment-capture/android-payment-ingestion/public.ts`, `application/ports/in/captureSubmissionInputPort.ts`, `application/ports/in/captureBranchSubmissionInputPort.ts`.
- 실제 입력·실행·저장 경계: 같은 모듈의 `application/captureSubmissionApplication.ts`, `application/captureBranchSubmissionApplication.ts`, `application/captureTransactionGatewayApplication.ts`; `functions/src/adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore.ts`; `functions/test/support/capture-branch-receipt-fixture.ts`.
- 요구사항: `docs/requirements/contexts/payment-capture/modules/android-payment-ingestion/requirements.md`의 `ING-SAVE-001/005`, `T-ING-AUTH-001`, `T-CAN-LINEAGE-001`; `docs/requirements/contexts/payment-capture/modules/shortcut-ingestion/requirements.md`의 `T-IOS-001`; `docs/requirements/contexts/household-finance/modules/local-currency/requirements.md`의 `T-BAL-008`.
- 기존 검토/검증 경계: `docs/verification/simplicity-2026-10-05/capture-tests.md`의 CT03, `docs/operations/capture-test-boundaries-2026-10-05.md`.

## 실행 검증과 한계

- 수정 전과 수정 후 `npm exec -- vitest run test/contexts/payment-capture/android-payment-ingestion/capture-submission-receipt.contract.test.ts`: 각각 1개 파일, 6개 테스트 통과, 종료 코드 0.
- 실제 이전/현재 helper를 TypeScript transpile 후 실행하여 직접 소비자의 승인 입력 10개, 취소 입력 2개와 정적 envelope 2개를 `assert.deepStrictEqual`로 비교했습니다. 모두 동일했습니다. 별도 알고리즘으로 기대값을 계산하지 않았습니다.
- 소유 파일에 대한 `git diff --check`: 통과, 종료 코드 0.
- 상위 작업의 통합 실행에서 Functions `test:types`와 실제 Firestore `capture-financial-flow.integration.test.ts` 5건이 통과했습니다. 동일 실행에 포함된 SDK와 저장 대역의 중첩 필드 비교 1건까지 실제 SDK 6건, in-memory unit 3건을 포함한 전체 3개 파일 9개 검사가 통과했습니다(9.74초, 종료 코드 0). 실행 로그는 `TEMP/household-remaining-six-sdk-20261005.log`입니다. helper 결과 비교와 실제 SDK 검증을 구분했습니다.
- 이 하위 작업은 commit·push·배포 또는 emulator 기동·종료를 수행하지 않았습니다. 제품 성능 변경이나 전체 저장소 감소율을 주장하지 않습니다.
