# 정기 계획·Scheduler 저장 경계 단순화 (2026-10-05)

FIN-09/03/04. 단건 계획 변경의 전체 plans/receipts 사전 조회, transaction 재조회, 배열 복제와 signature diff를 제거했습니다. 대상 planId·commandId receipt를 읽고 같은 transaction에서 한 번 판정해 변경된 plan·receipt·event만 저장합니다. 실제 creator, expectedVersion, receipt replay/payload 충돌, canonical 우선순위, legacy 호환 문서와 tombstone은 유지합니다. 카테고리 사용 가능성도 같은 transaction의 catalog 문서로 판정해 보관 전환과의 경합을 저장 경계 안에 둡니다. 목록은 계획만 읽으며 receipts를 가져오지 않습니다.

Scheduler의 readPlanPage를 필수로 만들고 테스트 때문에 남은 전체 조회 fallback을 삭제했습니다. fixture도 실제와 같은 page/cursor를 사용합니다. 실제 이벤트 전달은 transactional outbox가 담당하므로 noop after-commit publisher와 반환 committedEvents를 제거했습니다. fixture의 별도 published 배열도 없애 원자 저장된 outboxEvents를 관찰합니다.

## 계약과 검증

- REC-001/006, T-REC-003/007: 관련 단위·실행 adapter 8파일 80개 및 Functions tsc 통과.
- 실제 Firestore Emulator 6개 통과: 무관한 plan/receipt 400개에서 단건 update는 대상·legacy·receipt·catalog 총 4문서, 목록은 계획 query 2개이며 receipts 조회 없음.
- 동일 명령 동시 전송은 success/already-processed 한 쌍. 같은 version의 update/delete는 한 승자, plan version·receipt·outbox 수 불변 검증.
- 보관 중 category 거부, 최초 receipt replay 우선, outbox append 실패 시 canonical/legacy/receipt 전체 rollback, immutable creator·미이관 creator 거부·canonical 우선 검증.
- REC-002/003: 실제 1건 계획 페이지와 2개월 작업 checkpoint를 이어 2계획×3개월 거래 6건 및 outbox 12건을 한 번씩 저장. 시작 checkpoint 재전달 시 증가 없음. 기존 알림 outbox 실제 producer/consumer 검사에서 정기 생성 NoTarget 계약 통과.
- 경합 검사는 SDK lock/retry 두 묶음이 5초보다 길어 기본 unit timeout으로 처음 종료됐습니다. 업무 성능 기준이 아닌 integration 실행 한도를 30초로 지정했으며 단언·동시 전송·SDK 재시도는 유지합니다. 전체 실제 suite 실행은 약 9초였습니다.

로그: `TEMP/household-simplicity-recurring-management-20261005.log`. Firebase 배포는 최종 clean 후보에서 세 codebase를 함께 수행합니다.
