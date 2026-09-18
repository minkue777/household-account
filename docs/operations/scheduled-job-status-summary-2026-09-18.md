# 관리자 예약 작업 상태 요약

관리자 화면은 `scheduledJobRuns` 최근 최대 120건과 최신 monitor receipt를 읽어 상태를
추출하던 방식에서 `operations/runtime/scheduledJobStatuses/{jobName}` 조회로 전환합니다.
현재 정의된 작업은 monitor를 포함하여 7개입니다. 정상 조회는 기존 최대 121문서에서
7문서로 줄며, 아직 열린 장애가 있으면 복구 여부가 요약으로 확인되지 않는 해당 실행만
추가 조회합니다. Firestore의 빈 query 최소 과금 및 다른 대시보드 조회는 별도입니다.

`latestRun`과 `latestSuccessfulRun`은 실행 상태·예약/갱신 시각·집계만 갖습니다. 이전 예약의
늦은 완료는 최신 예약을 덮지 않으며 후속 실패로 이전 성공의 복구 근거를 잃지 않습니다.
동일 실행은 기존 lease fencing과 monitor 상태 검증을 그대로 따릅니다. 원본 실행, 완료
결과, 요약은 동일 transaction에서 갱신합니다. 실행 이력·receipt·Outbox는 삭제하지 않으며
기존 완료 30일 TTL과 미해결 이력 보존도 유지합니다. 최신 상태 요약에는 TTL을 적용하지 않습니다.

## 변경 소유 경로

- 상태 요약 형식·선택 규칙: `functions/src/adapters/firebase/operations/scheduledJobStatusSummary.ts`
- 실제 writer: `functions/src/adapters/firebase/operations/firebaseScheduledJobStores.ts`
- 대시보드 reader: `functions/src/adapters/firebase/admin/firebaseAdminDashboardReader.ts`
- 기존 상태 초기화: `functions/scripts/backfill-scheduled-job-statuses.mjs`
- 요구사항: 지원 플랫폼의 `external-operations/requirements.md` 및 `design.md`, JOB-ERR-001~002

## 기존 상태 초기화와 배포

아래 도구는 기본적으로 읽기 전용입니다. 출력에는 공개 작업명·상태·조회 건수·변경 필요
건수만 있으며 실행 대상이나 금융 자료는 포함하지 않습니다. 제품 빌드의 실제 요약 reducer를
재사용하므로 먼저 Functions를 빌드합니다.

```powershell
npm --prefix functions run build
node functions/scripts/backfill-scheduled-job-statuses.mjs --project household-account-6f300
```

검토 후 명시적으로 적용합니다. 알려진 job별 실행 기록과 현재 요약을 동일 transaction에서
읽고 갱신하며, concurrent writer 변경은 Firestore 재시도로 다시 대조합니다. 정상 최신 요약이
이미 있으면 그대로 보존하고, 변경이 없는 재실행은 쓰지 않습니다.

```powershell
node functions/scripts/backfill-scheduled-job-statuses.mjs --project household-account-6f300 --apply
```

최초에는 서버 배포 직전 초기화하고, 새 writer 배포 직후 다시 실행하여 전환 중 기록까지
확인합니다. 초기화가 끝나지 않은 항목은 UNKNOWN으로 표시하며 과거 실행을 상시 조회하지
않습니다. 배포 이후 신규 실행과 초기화가 경합해도 원본 query와 요약이 함께 검증됩니다.
도구는 기존 실행·결과·monitor receipt·장애를 수정하거나 삭제하지 않습니다.

이 문서는 구현·검증 절차이며 운영 초기화를 실행했다는 증거가 아닙니다.

## 로컬 검증

- 상태 writer/reader, 기존 lease fencing·장애 복구, runner/monitor 계약, TTL 및 요구사항 추적성: 10파일 57개 통과.
- 실제 Firestore 에뮬레이터: 동시 완료와 초기화 경합, commit 직전 실패의 원자적 rollback·재시도 2개 통과.
- Functions 전체 테스트 TypeScript 검사 통과.
