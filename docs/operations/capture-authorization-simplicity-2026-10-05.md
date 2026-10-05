# 결제 수집 인가와 과거 Shortcut 정책 정비

PT-09와 Capture 6번을 처리했습니다. 운영에서 호출하지 않는 일반 tenant CRUD 정책·actor resolver·가상 레코드 저장소를 제거했습니다. 유일한 수집 호출은 이미 검증된 actor의 householdId를 자기 자신과 비교하고 있었고 bootstrap의 Membership 조회도 항상 undefined를 반환하는 대역이었습니다. 실제 수집 인가는 actor 존재, 가구, 멤버, `paymentCapture:submit` capability를 직접 확인합니다. 본문 값으로 명의를 결정하지 않으며 기존 인증·Membership router는 유지합니다.

Firestore Rules는 같은 가구의 읽기를 허용하면서도 모든 Client SDK 쓰기를 금지합니다. 서버 권한과 다른 이 계약을 가상 CRUD application으로 대신하지 않습니다. `T-HH-RULES-001`은 실제 Rules suite로 옮겼고 `T-SEC-001`과 함께 추적합니다.

구 Shortcut의 FCM/카드/요청 본문 명의 추론은 테스트 외 소비자가 없었습니다. 과거 동작 비교를 위한 코드와 검사를 test 영역으로 옮겼습니다. 현재 Shortcut의 검증된 credential 명의 처리는 변경하지 않았습니다.

검증: 실제 수집 application과 parser→receipt→Firebase adapter 등 관련 4개 파일 34개, Functions TypeScript 검사 통과. 실제 Firestore Emulator/Client SDK Rules 15개 통과 (`TEMP/household-simplicity-tenant-rules-20261005.log`). 서버 공유 소스 변경으로 세 codebase 배포 대상이며 클라이언트 변경은 없습니다.
