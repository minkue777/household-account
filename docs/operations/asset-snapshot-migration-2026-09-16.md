# 자산 이력 날짜별 Snapshot 전환

## 운영 데이터 이전 결과

2026-09-16 사용자 요청에 따라 `asset_history` 전체를 확인하고 누락된 날짜를 이전했다.

| 항목 | 결과 |
|---|---:|
| 원본 문서 | 4,514 |
| 가구·날짜 조합 | 441 |
| 기존 assetSnapshots | 161 |
| 새로 추가한 과거 Snapshot | 280 |
| 이전 후 assetSnapshots | 441 |
| 미이전 날짜 / 금액 충돌 | 0 / 0 |
| 대조한 원본 금액 | 4,514 / 4,514 |

총자산·금융자산·유형별·명의자별 금액을 각각 비교했다. 명의자는 같은 가구의 기존 Snapshot 표시 이름과 보존된 명의자 프로필로 유일하게 연결되는 경우만 이전한다. 미해결·동명이인 후보·서로 다른 이름의 동일 key 충돌은 실행을 중단한다. 과거에 총자산·금융자산만 저장된 날짜에는 유형·명의자 값을 만들어 넣지 않는다. `sourceAssetVersions`도 과거 사실을 추정하지 않고 빈 map으로 남긴다.

적용 plan hash: `b0b693464c337db87fc615910c7d7fa7a8823668245b1e59938a845390ac8ea1`.
기존 Snapshot과 원본 문서는 수정·삭제하지 않았다. 원본의 changeAmount·memo·기존 timestamp 등은 원본에 보존하고, 통계 변동액은 날짜별 잔액 차이로 계산한다.

## 실행 도구

```text
node functions/scripts/migrate-asset-history.mjs --project household-account-6f300
node functions/scripts/migrate-asset-history.mjs --project household-account-6f300 --apply --confirm-project household-account-6f300 --expected-plan-hash <dry-run hash>
```

기본은 읽기 전용 dry-run이다. apply는 같은 프로젝트·검토한 plan hash를 요구한다. 모든 원본을 검증한 뒤 누락된 날짜만 create precondition으로 추가한다. 기존 Snapshot을 덮어쓰지 않고, 완료 후 원본 hash와 모든 금액을 다시 비교한다. 중간 실패가 발생하면 새 dry-run을 검토하여 남은 날짜만 재실행한다. 오류 출력에는 원본 문서·가구 ID·금액을 넣지 않는다.

이 도구는 운영자 전용 스크립트이며 Functions export 또는 앱에서 호출하지 않는다. 배포 전에 실제 Firestore Emulator와 CLI로 이전·재실행·충돌 중단을 검증했다.

## 런타임 전환과 호환성

- Web 통계는 `households/{householdId}/assetSnapshots`만 읽는다. 페이지 분할·기간 기준점·세션 격리·기존 캐시 정책은 유지한다.
- Snapshot Projector는 날짜별 한 문서만 읽고 저장한다. 구형 8~12개 문서의 동시 저장과 legacy baseline 조회, 중복된 직전 날짜 조회를 제거한다.
- 사용하지 않는 `assetService` 이력 조회·전월 총액·월간 변동 함수와 변환기를 제거한다.
- 최초 전체 조회 기준 전체 가구 합산 문서 수는 4,514 + 161 = 4,675개에서 441개로 약 90.6% 줄어든다. 캐시가 있는 조회나 일부 기간 조회의 실제 청구 절감률과 같다는 뜻은 아니다.
- 구형 원본은 복구 자료로 남긴다. 이미 열린 이전 Web도 정상 조회하도록 기존 read-only Rules/index는 유지하고, 가구 영구 삭제 시 원본까지 정리하는 purge 경로도 유지한다. 현재 앱의 일반 조회·저장 코드는 원본을 사용하지 않는다.
- 순서는 운영 마이그레이션 및 대조 완료 → Web Git 자동배포·Firebase 단일 Writer 배포다. 중간 단계의 이전 Web도 canonical 날짜를 우선하므로 중복 표시하지 않는다.

## 검증

- Web 통계·세션 회귀 39개 통과.
- 실제 Firestore Emulator: migration CLI 5개, Projector·Scheduler 3개 통과.
- E2E는 이전된 날짜와 같은 canonical 구조의 과거 금액·기간 전환, 구형 조회 없음, 자산 삭제 후 Snapshot 보존, Scheduler의 구형 문서 생성 없음을 검증한다.
- 전체 CI와 배포 결과는 최종 commit의 GitHub Actions 및 운영 release provenance로 확인한다.
