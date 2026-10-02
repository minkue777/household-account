# 분배금 최초 수량 이력 누락 수정 — 2026-10-02

## 확인된 결함

또니망고네의 RISE 미국나스닥100(368590), 기준일 2026-09-30·지급일 2026-10-02·주당 44원 이벤트는 source Asset 5개 중 수량 증거 4개만으로 2,332주·102,608원을 확정했습니다. 누락된 민규 개인 연금저축은 2026-07-21 완료 이관 계획에 855주로 보존되어 있지만 positionHistory가 없습니다. 지운 계좌는 400주·17,600원으로 이미 포함되었습니다. 누락 계좌를 포함한 산술 합계는 3,187주·140,228원입니다. 이는 세전 분배금 계산이며 증권사 실입금 대사를 대신하지 않습니다.

원인은 이관 Collector가 Position만 생성하고 최초 수량 이력을 계획하지 않은 점, 일부 source의 이력이 없어도 Application이 부분 합계를 확정한 점, 동일 공시에서는 fixed의 불완전한 근거를 재계산하지 않은 점입니다.

## 요구사항·계약·상세 설계

- `HOLD-004`: 새 이관은 각 Position과 같은 원천 fingerprint를 가진 최초 positionHistory 후보를 함께 생성합니다. history 금액은 0으로 두어 평가액을 중복 합산하지 않습니다. 결정적 ID·계획 hash·재실행·원천 변경 검증·전체 대상 대사에 포함합니다. 계획 관측 시각을 서울 날짜로 변환하며 기존 Position에 임의 이력을 만들지 않습니다.
- `DIV-005`: Holdings Query는 요청된 가구·종목·계좌에 일반 이력이 없다면 `operationsMigrationPlans`의 completed, nextIndex=candidateCount인 계획만 조회합니다. action=create, logicalCollection=position, targetPath와 targetData의 identity가 모두 맞는 최초 수량을 계획 생성 시각의 읽기 전용 snapshot으로 반환합니다. 잘못된 수량·시각·가구·경로·미완료 계획은 복구 근거가 아닙니다. 현재 Position 수량이나 updatedAt을 과거 수량으로 사용하지 않으며 운영 history·계획을 변경하지 않습니다.
- `DIV-003/005/006`: announced 확정과 fixed 정정은 모든 sourceAssetIds를 포함하는 유효 수량 증거가 필요합니다. 0주 snapshot도 유효 근거입니다. 빈 근거는 POSITION_HISTORY_NOT_OBSERVED, 일부 누락은 POSITION_HISTORY_INCOMPLETE입니다. fixed에 명시된 eligibilityContributions가 부분이면 동일 공시도 재계산하고 version 검사와 기존 단일 Writer를 통과합니다. 공급자 실패·NoData 시 해당 부분 fixed는 paid로 넘기지 않습니다. 증거 필드 자체가 없는 구버전 fixed는 기존 동작을 유지하고 paid는 변경하지 않습니다.
- `DIV-004`: 같은 sourceReferenceHash라도 수량·증거 정정은 unchanged로 무시하지 않습니다. 저장소는 완전한 계좌 근거·수량 합계·version을 검증하고 Event·receipt·Outbox를 원자 저장합니다. 기존 Annual Projector가 정정된 Event로 월 합계를 다시 만듭니다.

## 테스트 추적성

| 요구사항 | Canonical | 실행 증거 |
|---|---|---|
| DIV-003/004/005/006 | T-DIV-008 | dividend-initial-history-regression.test.ts: 부분 확정 차단, 동일 공시 fixed 복구, 미복구 지급 차단, 0주, 충돌·paid 보존·재실행·월 합계 |
| DIV-005 | T-DIV-008 | dividend-migrated-position-history.test.ts: 완료 계획·scope·경로·잘못된 관측값·일반 이력 우선·현재 수량 비사용 |
| HOLD-004 | T-HOLD-001 | portfolio-initial-history-migration.test.ts와 firebase-runtime-migration.integration.test.ts: 초기 history 후보·서울 날짜·금액 중복 없음·실제 저장·재실행 |
| DIV-004/005/006 | T-DIV-008 | firebase-dividend-schedule.integration.test.ts: 실제 Emulator에서 이관 근거 → 전체 계좌 fixed 정정 → paid·Annual Projection |

## 배포·운영 범위

Functions 실행 코드 변경이므로 세 codebase를 기존 Firebase release wrapper로 배포합니다. Web·Android 실행 코드와 공용 클라이언트 계약은 변경하지 않습니다. 기존 운영 history의 백필이나 직접 데이터 수정은 하지 않습니다. 미지급 이벤트는 배포 후 정상 배당 예약 작업에서 완료 이관 근거로 재계산할 수 있습니다. 이미 paid인 이벤트는 이 작업으로 수정하지 않습니다.

## 검증 결과

- 수정 전 신규 회귀 23개 중 8개가 실패했습니다. 부분 합계 paid 진행, 동일 공시 정정 누락, 이관 최초 history 누락을 재현했습니다.
- 수정 후 관련 8개 파일 65개가 통과했습니다. `tsc -p tsconfig.test.json --noEmit`, architecture 45개, runtime boundary 0건도 확인했습니다.
- 실제 Firestore Emulator의 배당·이관 통합 2개 파일 23개가 통과했습니다. 완료 이관의 855주 읽기 → 3,187주·140,228원 fixed 정정 → paid → 10월 Projection 합계 → 재실행 무변경을 확인했습니다. 운영 history를 새로 쓰지 않는 점도 검증했습니다.
- Emulator는 정상 종료됐으며 통합 로그는 `%TEMP%/household-dividend-history-emulator-20261002.log`입니다.
- 배포·정확한 SHA의 원격 CI 결과는 후속 확인합니다.
