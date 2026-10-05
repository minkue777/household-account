# 자산·보유종목 저장 확정 응답

## 계약·설계

FIN01/W1의 서버 확장 단계다. AST-001/003/006, HOLD-001/002/003 명령은 같은 transaction에서 계산한 자산과 종목을 `confirmation: { schemaVersion: 1, occurredAt, assets, positions }`로 반환하고 같은 receipt에 저장한다. 기존 생성 ID 필드는 유지한다. 순서 변경은 활성 자산들의 실제 결과 버전을 반환한다. 종목 추가·수정·삭제는 부모 자산 평가 결과도 함께 반환한다.

확정 객체는 canonical 업무 필드만 포함한다. Firestore가 commit 때 정하는 createdAt/updatedAt은 포함하지 않으며 occurredAt은 명령 업무 시각이다. 사용하지 않는 generic Record 결과 대신 명령 결과의 필드를 타입으로 선언했다. 선택 필드의 undefined는 응답/receipt에서 생략한다.

기존 receipt는 confirmation 없이 원래 결과를 재생한다. 이를 현재 상태나 클라이언트 expectedVersion+1로 합성하지 않는다. 새 Web 소비자는 구형 receipt일 때 실제 authoritative 조회를 기다려야 한다. 서버 먼저 배포하고 Web을 전환한다. **현재 Web 전환과 Firebase 배포는 남아 있다.**

## 검증

- Functions 타입 검사 통과.
- 실제 portfolio store 단위 및 자산 scheduled page: 2파일 30개 통과. 기존 canonical/이력/Outbox/버전 거절 assertions 유지.
- 실제 Firestore 통합 3개 통과: 정규화·선택 필드 제거·순서·삭제 응답과 canonical 업무 필드 전체 비교, 동일 receipt 결과 재생, 종목+부모 자산 동시 수정의 한 승자, 구형 receipt 그대로 재생.
- 실제 저장 Timestamp와 업무 시각을 구분하는 assertion을 포함한다. 테스트 동안 운영 자료 변경은 없다.
- 로그: `TEMP/household-simplicity-portfolio-confirmation-20261005.log`.
