# 이름 변경과 접속 통계 계약 정비

## 원인과 변경

- HH-009/T-HH-004: 저장 adapter는 본인의 Member만 읽으면서 정책에는 전체 멤버 목록처럼 전달했습니다. 실제 Emulator에서 다른 가족 이름으로 변경 및 두 멤버의 같은 이름 동시 선점 검사가 수정 전 모두 실패했습니다(2 failed, 1 passed).
- 전체 상태 `read → 복사 → 변경 → diff`를 제거했습니다. 본인 정보·충돌 여부·해당 receipt를 판정에 전달하고 명시적인 변경 한 건을 Member·프로필·Membership view·legacy mirror·receipt·outbox에 원자 저장합니다. 공통 가구 문서 쓰기가 동일 이름 선점을 직렬화합니다.
- 접속 통계는 30일을 넘긴 날짜를 계산에서 지웠지만 Firestore의 `merge: true`가 중첩 map의 오래된 키를 보존했습니다. 실제 SDK 재조회로 재현했습니다(1 failed). 최상위 필드 단위 병합으로 일별 map을 교체하며 최초 생성 시각·누적 수·플랫폼 수·영구 방문 receipt를 보존합니다.
- SDK를 흉내 낸 이름 변경 adapter 테스트 한 개의 모든 저장 assertion을 실제 Emulator 검사로 옮겼습니다. 해당 테스트를 통과시키기 위해 제품에 모의 SDK 호환 코드를 추가하지 않습니다.

## 검증

- 실제 Firestore 이름 변경 3개 및 접속 통계 1개 통과(실패·skip 0).
- 기존 이름 변경 정책 계약 7개 통과. 서버 test TypeScript 검사 통과.
- 로그: `TEMP/household-simplicity-rename-red-20261005.log`, `TEMP/household-simplicity-retention-red-20261005.log`, `TEMP/household-simplicity-access-green-20261005.log`.
- 운영 자료 직접 수정은 하지 않았습니다. Firebase 배포와 전체 CI는 최종 후보에서 별도로 기록합니다.
