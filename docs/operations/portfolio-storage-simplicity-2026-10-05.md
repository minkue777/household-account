# 자산 조회와 종목 목록 저장 경계 단순화

FIN-05/FIN-08, AST-006/MARKET-005 정비입니다. 운영 자료를 변경하지 않았습니다.

- 삭제 자산 조회는 첫 조회에서 이름·삭제시각·version을 보존해 반환합니다. 관리자 handler의 ID별 추가 조회를 없앴습니다. 다른 가구 문서, active/purging 제외와 복구 권한·version 계약은 유지합니다.
- 종목 발행 전 가상의 checksum/generation/업로드 성공 flag/receipt를 만들던 모형을 없앴습니다. application은 검증한 날짜·종목·공급자별 수량만 넘깁니다. 실제 adapter가 gzip→immutable 업로드→다운로드 checksum/generation 검증→latest generation CAS→receipt 순서로 확정합니다.
- 업로드만 남은 실패 객체를 성공 날짜로 세던 retention도 확정 receipt의 최근 세 날짜를 기준으로 바꿨습니다. 현재 latest 객체를 보존하며 더 새로운 미공개 객체는 지우지 않습니다.
- 메모리 fixture 자체의 발행/보존/경합 검사를 실제 Storage/Firestore SDK 검사로 옮겼습니다. source 실패와 read cache 검사는 application을 계속 통과합니다. CI의 Firebase integration 실행에도 Storage emulator를 포함합니다.

검증: Functions tsc, lifecycle 계약 23개, catalog source/cache 8개 통과. 실제 Firestore 관리자 통합 4개와 Storage/Firestore 발행 통합 5개 통과. 삭제 목록은 query 1회·개별 get 0회와 반환값을 함께 확인했습니다. 발행은 gzip 원문·SHA256·generation·receipt 재생·최근 3일·미공개 미래 객체·본문 충돌·오래된 generation·업로드 재검증 실패를 확인했습니다. CAS 412는 SDK save 경계에 주입해 precondition 전달과 기존 latest/receipt 보존을 확인한 것으로, emulator가 실제 Cloud Storage 경합을 보장한다는 의미는 아닙니다.

로컬 로그: TEMP/household-simplicity-asset-admin-20261005.log, TEMP/household-simplicity-catalog-storage-20261005.log. Firebase 배포는 전체 simplicity 작업의 누적 서버 후보로 진행합니다.
