# 자산 조회 실패·명의 조회 정비 (2026-10-05)

UI-01/WT-06/W11. 자산과 주식/코인 listener의 오류를 빈 배열 성공으로 바꾸는 경로를 제거했습니다. snapshot hook은 마지막 정상 자료, 준비 여부, 오류를 따로 보존합니다. 최초 구독 설정 실패는 ready가 아니며 부분적으로 열린 listener를 정리합니다. 실패 전 확인값이 없으면 평가금액 확인 불가, 있으면 마지막 확인값과 오류를 보여줍니다. 정상 빈 snapshot일 때만 0원과 빈 보유를 표시합니다. 재시도는 현재 가구의 listener를 다시 열고 이전 listener의 늦은 응답은 무시합니다. 자산 통계의 현재 값 실패도 이력 성공/실패와 별도로 표시합니다.

명의 조회는 한 줄 위임 class·interface·singleton 두 파일을 제거하고 실제 Firestore 구독 함수로 바로 연결했습니다. 생성 순서, stable profileId, 보관·숨김 명의의 과거 이름과 신규 선택 가능 여부는 그대로입니다.

## 검증·추적성

- AST-001/002, HOLD-001~004: 실제 service → snapshot hook → manager → AssetHistoryModal/목록의 SDK 오류·재구독·정상 빈 값 연결 검사 1개 통과.
- `portfolioAssetStartupSync`는 실제 service의 자산/주식/코인 오류와 해제 뒤 응답을 검사합니다. 기존 수정 대기 실패·rollback·pending overlay 계약도 유지했습니다.
- `householdHoldingSnapshots`는 최초 실패, 이전 자료 보존, 부분 setup 정리, actor 전환과 늦은 오류를 검사합니다.
- 상세 화면 실제 manager/목록의 주식·코인 3개, 실제 자산 페이지의 최초 실패·마지막 자료 보존, 명의 adapter mapping/오류/페이지 연결을 검사합니다.
- 위 관련 6파일 총 52개 통과 및 Web tsc 통과. production 배포 검증과 CI는 최종 후보를 따릅니다.

로그: `TEMP/household-simplicity-holding-read-20261005.log`.
