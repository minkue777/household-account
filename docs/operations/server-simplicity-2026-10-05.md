# 서버 실행 경로 정비

## 유지할 계약과 작은 구현

- CARD-001~005: 카드 등록·번호 수정·퇴역·전체 순서 변경은 현재 상태와 명령에서 변경 결과를 직접 계산합니다. 임시 mutable application 생성, `.state()` 회수, JSON 직렬화 비교를 제거했습니다. claim·receipt·버전·원자 저장의 소유자는 기존 실제 Firebase adapter입니다.
- MER-007: 카테고리 보관의 한 페이지 변경은 순수 함수입니다. 매 페이지 생성되어 의미가 없던 메모리 처리 이력을 없앴습니다. 실제 receipt와 cursor 재개는 원래 DB 트랜잭션이 담당합니다. 실패 시 commit하지 않는 동작은 저장 경계에서 검증합니다.
- 테스트만 수행하던 카드 과거 검색을 제품 코드에서 없앴습니다. 실제 카드 수정·삭제 후 거래를 재조회하는 Emulator 검사로 보존을 검사합니다. 검색은 실제 Web `ledgerSearchVisibility` 경로의 카드사·끝 번호·증거 우선순위 검사로 확인합니다. 일반 복구 명령이 없다는 검사는 임의 배열 대신 실제 명령 manifest를 확인합니다.

## 미사용 모형 제거

서버 client-session 5개 파일, scripted HTTP 두 구현, 가상 ingress 두 구현·결과 분류·예제 HTML 파서, 메모리 가맹점 persistence/remember 세 구현과 전용 타입·포트를 제거했습니다. 심볼과 module import를 서버·테스트·Web·Android·도구에서 재검색했고 실제 호출자는 없었습니다. Web/Android 세션, 실제 SafeExternalText HTTP와 Node transport, 실제 공급자 파서·인증 router, 실제 기억하기 mutation은 유지합니다.

이름이 `public.ts`인 파일만 테스트하도록 강제하거나 모든 계약 테스트에 `Subject/createSubject`를 요구하던 문법 검사를 제거했습니다. 이 제약은 실제 구현을 숨긴 별도 모형을 만들게 했으며 업무·보안 계약을 검사하지 않았습니다. 실제 결과 assertion과 상수 assertion 방지, 추적성·보안 경계 검사는 유지합니다.

## 검증과 추적

- 결제 설정·실제 HTTP·문서/추적성 19파일 161개 통과. 별도 카드 Firebase adapter/버전 검사 포함 3파일 32개 통과. test TypeScript 통과.
- 실제 Firestore 카드 3개와 가맹점 3개 통과: 중복 등록 경합, 버전 경합, 저장된 과거 거래 보존, claim 해제, receipt 재전송.
- 신규 검사의 메서드 이름과 저장 필드 표기 오류는 실제 wire/저장 계약에 맞춰 정정했습니다. 제품 결함으로 분류하지 않습니다.
- 실제 HTTP 보안 회귀: host/redirect/port/timeout/byte 상한 및 Node transport 검사 유지.
- 미사용 모형의 삭제가 새로운 업무 기능 구현을 의미하지 않습니다. 운영 데이터 직접 수정과 과거 실패 기록 변경은 없습니다.

로그: `TEMP/household-simplicity-card-atomic-20261005.log`. Firebase 배포 및 전체 CI는 최종 후보에서 따로 기록합니다.
