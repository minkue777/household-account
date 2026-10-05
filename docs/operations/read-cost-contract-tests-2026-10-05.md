# 저장 보존과 조회 비용을 실제 경계에서 구분

PT-08: 기존 ledger category 조회 mock은 receipt가 이미 존재하는 경로였습니다. 제목을 재전송 검사로 좁히고 실제 Emulator/SDK 명령을 추가했습니다. 최초 메모 수정·알림 요청·삭제가 원장 문서를 실제 읽고 저장하며 catalog는 읽지 않는지 관측합니다. 명시적 분류 수정에서는 실제 catalog 읽기를 확인하고 stale version 거부를 유지합니다. 알림 요청도 notificationRequest와 aggregateVersion을 변경하므로 후속 삭제는 그 확정 version을 사용합니다.

TB-01: 기존 월/항목 분할의 실제 transaction·query·document SDK read 결과에서 무관 거래가 로드되지 않음을 확인합니다. 무관 260개 문서 각각의 updateTime도 작업 전후 비교하여 같은 값을 다시 쓰는 구현까지 탐지합니다. 금액·원장·계보·파생 version·복구 결과 검사는 그대로 유지했습니다. SDK의 read는 call-through spy로 관측하며 결과나 transaction 동작을 대체하지 않습니다.

TB-02: CaptureEnvelope golden 검사를 공유 schema·예제 일관성으로 명명했습니다. fixture끼리의 비교를 실제 parser→intake 실행으로 보고하지 않습니다. 실제 파싱·거래/잔액 branch 실행은 raw-capture-production-flow, capture-submission-payment-kind, firebase-finance-command-adapters 통합 검사 및 payment-capture.spec.ts가 담당합니다.

## 검증

실제 Firestore Emulator/SDK 금융 명령 통합 23개 통과, Functions TypeScript 통과. 로그 TEMP/household-simplicity-ledger-read-cost-20261005.log.

## 카테고리 CI 응답 관측 수정

d2b6a9c CI 37261747621의 Functions unit 2건은 새 catalogVersion 응답을 여전히 빈 객체로 기대하여 실패했습니다. 실제 저장 결과는 카테고리 수정 2, archive 완료 3이며 그 정확한 응답으로 검사를 갱신했습니다. stale version·과거 원장 보존·정기 계획 remap·재전송 검증은 유지합니다. 제품 코드 추가 변경은 없으며 과거 실패 기록은 보존합니다.
