# Access 연결 교정과 가구 영구 삭제 운영 절차

이 문서는 `functions/scripts/access-operations.mjs`를 통한 명시적 운영 요청 절차입니다. 자동 실행이나 정기 purge는 없습니다. 실제 운영 실행은 별도로 승인된 대상에만 수행합니다.

## 실행 준비

- 변경된 코드의 필수 quality gate와 관련 Web/Android 테스트·production build를 먼저 통과시킵니다. 배포된 revision과 사용할 CLI build를 일치시킵니다.
- CLI는 Firebase Admin SDK의 ADC와 별도의 Firebase 사용자 ID token을 모두 요구합니다. 서비스 계정만으로 관리자 권한을 대신할 수 없습니다. 사용자 token의 취소 여부도 검증합니다.
- 모든 작업에 `systemAdmin: true`가 필요합니다. 영구 삭제 관련 작업은 추가로 `householdPurgePermanent: true`를 요구합니다. token 파일은 비공개 로컬 위치에 보관하고 출력·커밋·공유하지 않습니다.
- 운영 프로젝트는 `household-account-6f300`만 허용합니다. `demo-*`는 Firestore Emulator 설정이 있어야 하며 운영 프로젝트와 Emulator 설정 혼합은 거부합니다.
- 가구 ID를 `--household`와 `--confirm-household`에 같은 값으로 명시합니다. 연결 교정의 Principal UID/Member ID와 운영 승인 근거를 대조합니다.

다음 예제의 값을 승인된 실제 값으로 바꿉니다. 예제 자체는 실행 요청이 아닙니다.

```powershell
npm --prefix functions run build
$accessArgs = @(
  '--project', 'household-account-6f300',
  '--household', '<household-id>',
  '--confirm-household', '<household-id>',
  '--operator-token-file', '<private-token-file>'
)
```

## 연결 교정

기존 로컬 가구 키를 Google 계정으로 연결하는 전환 경로는 Functions 환경 설정 `LEGACY_MEMBERSHIP_CLAIM_ENABLED`로 종료할 수 있습니다. 미설정은 기존 전환 호환을 유지하고 문자열 `false`일 때만 비활성화합니다. 종료 설정을 포함한 Functions를 필수 배포 gate를 거쳐 배포하면 `ResolveSignedInUser`의 first-visit 응답은 `legacyClaimEnabled: false`를 반환합니다. Web은 저장된 legacy 후보를 버리고 생성/초대 화면을 표시하며 직접 claim 호출도 `LEGACY_CLAIM_DISABLED`로 거부합니다. 이미 확정된 Membership의 로그인이나 명시적 관리자 교정은 이 전환 flag와 별개입니다. 이번 수정 작업에서는 운영 환경 설정을 바꾸지 않았습니다.

기존 Member와 Principal의 연결 근거가 확인된 경우에만 수행합니다. 같은 request ID는 같은 결과를 재생합니다. 다른 payload를 같은 ID에 넣으면 충돌이며, 입력 오류를 숨기려고 request ID만 바꾸지 않습니다.

```powershell
node functions/scripts/access-operations.mjs @accessArgs --operation repair-membership --principal '<principal-uid>' --member '<member-id>' --reason '<승인 근거>' --request-id '<repair-request-id>'
```

교정과 감사 기록은 같은 transaction에 저장됩니다. 감사에는 운영자와 사유 hash, 대상 참조 hash를 남기며 사유 원문을 복제하지 않습니다.

과거 논리 삭제/복구에서 claim의 가구 상태 projection만 누락된 경우 다음 명령을 사용합니다. 원래 household/member binding은 바꾸지 않습니다. 결과의 `nextCursor`가 있으면 같은 사유로 `--after`를 넣어 다음 페이지를 실행합니다. `purging`/`purged` 가구는 claim 변경 장벽으로 거부합니다.

```powershell
node functions/scripts/access-operations.mjs @accessArgs --operation repair-claim-lifecycle --reason '<승인 근거>'
node functions/scripts/access-operations.mjs @accessArgs --operation repair-claim-lifecycle --reason '<승인 근거>' --after '<nextCursor>'
```

## 영구 삭제 요청과 재개

대상이 이미 논리적으로 `deleted`인지 확인하고 현재 aggregate version을 사용합니다. `purging` 이후에는 복구할 수 없습니다. 동일 가구·request ID가 동일 process ID를 결정하므로 모든 후속 작업에 같은 request ID를 유지합니다.

```powershell
node functions/scripts/access-operations.mjs @accessArgs --operation purge-request --request-id '<purge-request-id>' --expected-version '<current-version>' --confirmation '<복구 불가능한 영구 삭제에 대한 별도 승인 근거>'
node functions/scripts/access-operations.mjs @accessArgs --operation purge-status --request-id '<purge-request-id>'
node functions/scripts/access-operations.mjs @accessArgs --operation purge-step --request-id '<purge-request-id>'
```

`purge-step`은 한 단계/페이지를 처리합니다. `progressed`이면 status를 확인하고 같은 요청으로 다음 step을 실행합니다. `retryable-failure`는 장애 원인을 해소한 뒤 같은 checkpoint부터 재개합니다. `operational-conflict`는 해당 participant의 `lastFailureCode`를 확인하여 원인을 교정하기 전까지 중단합니다. `completed` 또는 `already-completed`가 최종 결과입니다.

처리 순서는 다음과 같습니다.

1. UID claim snapshot을 모두 확정합니다. Process 본문에는 count/checkpoint를 두고 `claimSnapshots` 하위 문서에 snapshot을 저장합니다. 현재 페이지만 로드합니다.
2. Ledger가 남아 있는 동안 옛 Shortcut HTTP 성공 receipt의 transaction ID로 소유를 확인합니다. 확인된 현재 가구의 receipt만 householdId를 보완합니다.
3. Finance, Payment Capture, Portfolio, Notifications, Access Context 데이터를 순차적으로 삭제합니다. 캡처 원문 `notification_debug_logs`와 가구 소유 HTTP receipt도 포함합니다. 소유가 확인된 부모는 하위 leaf부터 지웁니다.
4. Notifications는 옛 Inbox를 Outbox/Intent로 대조하여 소유를 보완한 뒤 삭제합니다. Shared Outbox는 이 단계 뒤에 지웁니다.
5. Snapshot과 현재 claim의 가구·Member·version을 비교하여 바뀌지 않은 claim만 해제합니다. 다른 가구로 바뀐 claim은 보존하고 `claimConflicts`에 기록합니다. 모든 페이지가 끝나야 `purged`와 완료 Event를 한 번 확정합니다.

## 소유 미확정 자료와 orphan

`SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED` 또는 `NOTIFICATION_LEGACY_OWNERSHIP_UNRESOLVED`이면 연결 근거가 없거나 사라진 legacy 자료가 있다는 뜻입니다. 다른 가구 자료를 추측으로 삭제하거나 오류를 무시하지 않습니다. 승인된 운영자가 원래 거래/Outbox/Intent 근거로 소유를 복원한 뒤 재개합니다. 근거가 없으면 실패 상태를 유지합니다.

옛 실패/미완료 Shortcut HTTP receipt에 성공 거래·Member 결과가 없고 hash/error/TTL만 남은 경우에는 특정 가구 소유로 간주하지 않습니다. 이미 가구 소유를 기록하는 새 receipt에는 이 예외가 적용되지 않습니다.

Canonical `households/{id}/...` 경로는 부모가 없어도 가구 소유가 확정됩니다. 일반 query가 놓치는 missing-parent 하위 문서는 `listDocuments()`의 문서 참조 조회로 찾습니다. 기존 문서가 없는 경우에만 이 fallback을 사용하지만 Admin SDK의 참조 목록 API는 컬렉션 단위이므로, orphan이 매우 많은 컬렉션은 운영 비용과 처리 시간을 점검해야 합니다. 삭제 수는 페이지 크기로 제한합니다.

Legacy top-level의 부모가 없고 하위 자료에도 householdId가 없다면 경로만으로 소유를 확정할 수 없습니다. 운영 inventory에서 이를 발견하면 소유 근거를 먼저 교정해야 합니다. 단순히 부모를 삭제하는 방식으로 정리하지 않습니다. 전역 알림 device 등 특정 가구가 소유하지 않는 자료는 보존합니다.

## 중단된 lease 해제

실행 중복을 막는 lease는 시간만으로 자동 탈취하지 않습니다. 먼저 기존 worker/CLI가 실제로 중단되었는지 확인합니다. status가 출력한 현재 lease token을 대조하고 승인된 복구 사유와 함께 해제합니다. 실행 중인 worker와 겹쳐 해제하면 안 됩니다.

```powershell
node functions/scripts/access-operations.mjs @accessArgs --operation purge-unlock --request-id '<purge-request-id>' --stopped-lease-token '<status의 현재 lease token>' --reason '<중단 확인과 복구 승인 근거>'
```

해제는 token이 정확히 일치할 때만 수행하며 사유 hash와 운영자를 감사 기록에 저장합니다. 이후 같은 request ID로 status/step을 재개합니다.

## 검증 근거

`functions/test/integration/firebase/firebase-access-operations.integration.test.ts`는 실제 Firestore Emulator에서 권한·논리 삭제 전제, page1 재시작, 변경 claim 보존, 부모 없는 다단계 하위 자료, 다른 가구/전역 device 보존, legacy 소유 미확정 실패, 700개 claim snapshot의 Process 크기 제한을 검증합니다. 운영 데이터에 이 테스트를 실행하지 않습니다.
