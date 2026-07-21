# Firestore TTL 전환 Runbook

## 목적

Firestore TTL은 `expiresAt`이 문자열이면 동작하지 않습니다. 이 절차는 과거 ISO 문자열 값을 Firestore `Timestamp`로 바꾸며, 거래·자산 이력·진단 로그처럼 영구 보존 대상인 문서는 건드리지 않습니다.

대상 collection group은 스크립트의 `TTL_COLLECTION_GROUPS` allowlist가 단일 기준입니다. 문서 경로나 ID는 보고서에 출력하지 않습니다.

## 사전 조건

- Functions와 `firestore.indexes.json`의 TTL override를 먼저 배포합니다.
- Application Default Credentials가 목표 Firebase 프로젝트에 접근할 수 있어야 합니다.
- 실행 직전 Firestore export 또는 동등한 복구 지점을 확보합니다.
- dry-run 결과의 `invalidCount`가 0인지 확인합니다.

## 1. 읽기 전용 계획 생성

```powershell
cd functions
node scripts/backfill-firestore-ttl.mjs --project <PROJECT_ID>
```

출력된 collection group별 `scanned`, `convertible`, `invalid`와 `planHash`를 보관합니다. dry-run은 문서를 수정하지 않습니다.

## 2. 승인된 계획 적용

```powershell
node scripts/backfill-firestore-ttl.mjs `
  --project <PROJECT_ID> `
  --apply `
  --confirm-project <PROJECT_ID> `
  --expected-plan-hash <DRY_RUN_PLAN_HASH>
```

프로젝트 확인값 또는 plan hash가 다르거나, 잘못된 날짜 문자열이 하나라도 있으면 쓰기를 시작하지 않습니다. 각 update에는 읽을 때의 update time precondition을 적용하므로 동시 변경된 문서를 덮어쓰지 않습니다.

## 3. 사후 검증

같은 dry-run을 다시 실행해 `convertibleCount=0`인지 확인합니다. TTL 삭제는 만료 시각 직후 즉시 실행된다는 보장이 없으므로, 문서가 잠시 남아 있는 것은 정상입니다.

부분 batch 적용 뒤 동시 변경 오류가 발생했다면 새 dry-run으로 새 plan hash를 만든 후 재실행합니다. 이미 `Timestamp`로 전환된 문서는 자동으로 제외됩니다.
