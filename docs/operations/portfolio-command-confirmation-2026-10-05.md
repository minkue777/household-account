# 자산·보유종목 저장 확정 응답

## 계약·설계

FIN01/W1의 서버 확정 응답과 Web 소비 경계다. AST-001/003/006, HOLD-001/002/003 명령은 같은 transaction에서 계산한 자산과 종목을 `confirmation: { schemaVersion: 1, occurredAt, assets, positions }`로 반환하고 같은 receipt에 저장한다. 기존 생성 ID 필드는 유지한다. 순서 변경은 활성 자산들의 실제 결과 버전을 반환한다. 종목 추가·수정·삭제는 부모 자산 평가 결과도 함께 반환한다.

확정 객체는 canonical 업무 필드만 포함한다. Firestore가 commit 때 정하는 createdAt/updatedAt은 포함하지 않으며 occurredAt은 명령 업무 시각이다. 사용하지 않는 generic Record 결과 대신 명령 결과의 필드를 타입으로 선언했다. 선택 필드의 undefined는 응답/receipt에서 생략한다.

기존 receipt는 confirmation 없이 원래 결과를 재생한다. 이를 현재 상태나 클라이언트 expectedVersion+1로 합성하지 않는다. 새 Web 소비자는 구형 receipt일 때 실제 authoritative 조회를 기다려야 한다. 서버 먼저 배포하고 Web을 전환한다. Firebase `release-20261005-simplicity-confirmation-b819e8a`의 세 codebase 배포와 실제 로그인 smoke가 완료됐다. artifact SHA256은 `58d55c231a284920aea7129f7ae93e9e1643aa7c29c4c22055d593e6f28e2e79`이며 서버 CI는 후속 확인 중이다.

Web 생성·수정·재정렬은 반환된 업무 상태를 동일 read-model mapper로 표시한다. 버전 +1과 클라이언트 현재 시각으로 성공 상태를 만들던 코드를 없앴다. 임시 화면 버전은 성공 확정값과 구별한다. 종목 명령의 부모 자산 결과를 다음 명령의 확정 버전으로 사용한다. 구형 receipt는 실제 서버 snapshot의 버전 진전을 기다리며 cache는 이 대기를 끝내지 않는다. 다른 가구·계좌의 응답은 거절하고, 세션 전환 뒤 늦은 응답은 새 화면에 적용하지 않는다. 실제 commit timestamp가 없으므로 기존 표시 시각을 유지하고 구독에서 갱신한다.

테스트 대역은 입력 snapshot과 명령 patch로 응답 DTO만 작성한다. 화면의 아직 저장되지 않은 후속 patch를 서버 응답으로 사용하지 않는다. 서버 정규화·평가·원자성 검사는 실제 Functions SDK 검사에서 수행한다.

## 검증

- Functions 타입 검사 통과.
- 실제 portfolio store 단위 및 자산 scheduled page: 2파일 30개 통과. 기존 canonical/이력/Outbox/버전 거절 assertions 유지.
- 실제 Firestore 통합 3개 통과: 정규화·선택 필드 제거·순서·삭제 응답과 canonical 업무 필드 전체 비교, 동일 receipt 결과 재생, 종목+부모 자산 동시 수정의 한 승자, 구형 receipt 그대로 재생.
- 실제 저장 Timestamp와 업무 시각을 구분하는 assertion을 포함한다. 테스트 동안 운영 자료 변경은 없다.
- 로그: `TEMP/household-simplicity-portfolio-confirmation-20261005.log`.

- Web 타입 검사 및 관련 Jest 3파일 55개 통과. 기존 FIFO/실패 복구/세션/재정렬 검증과 함께 실제 응답 버전·정규화 필드·최신 snapshot 우선·구형 receipt 대기·부모 자산 버전·계좌 경계 회귀를 확인했다.
- 실제 Emulator + production build의 portfolio-journeys 브라우저 검사를 실행 중이다. 로그: `TEMP/household-simplicity-web-confirmation-e2e-20261005.log`.
