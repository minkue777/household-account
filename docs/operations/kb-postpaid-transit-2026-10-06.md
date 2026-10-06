# 국민카드 후불교통 합계 알림 — 2026-10-06

## 입력과 범위

사용자가 첨부한 KB 앱의 알림 목록과 운영 진단 원문을 대조했다. 10월 2일 14:20에 `KB Pay`가 `KB국민카드 / 후불교통(신용) / 22건 30,550원 / 10/14 결제예정`을 보냈다. 카드번호·승인 문구가 없으므로 기존 KB parser에서 해석하지 못한다.

서버 파서에 후불교통 합계 형식을 추가한다. 이전 [국민 매출취소 파서](kb-sales-cancellation-2026-10-06.md)는 아직 운영 배포 전이므로 같은 Firebase 후보에 포함한다. 가맹점 매칭·권한·분류·취소·중복 방지 로직은 유지하며 운영 원문 재전송·지출 소급 생성은 수행하지 않는다.

## 요구사항·설계 계약

- `PARSE-KB-001`, `T-PARSE-001`: 카드사·후불교통 종류(신용/체크)·양의 건수/합계·결제예정일이 모두 있는 형식에서만 합계 한 건을 만든다. 일반 카드대금·프로모션·0/음수/상한 초과·잘못된 구분자/날짜/건수는 제외한다.
- 항목명은 `후불교통(신용) 22건`, 금액은 30,550원. 이용 월이 없어 수신일 10월 2일·서울 시각 14:20을 사용한다. 결제예정일 10월 14일이나 전월 말일로 추정하지 않는다. 게시 시각이 없으면 기존 주입 Clock 규칙을 적용한다.
- 카드번호는 만들지 않고 `companyLabel: 국민`만 기존 본인 카드 판정에 전달한다. 국민카드가 없는 가구원은 기존 `CARD_NOT_REGISTERED_FOR_ACTOR`로 거절한다. 기존 가맹점 규칙과 기본 분류가 동일하게 적용된다.
- 원문/응답 스키마·parser version·fingerprint는 유지한다. 같은 입력의 재전송과 새 observation 중복도 기존 저장 계약을 따른다.
- 구현은 KB parser의 명시적 형식 분기와 기존 금액·날짜 검증 및 수신 시각 helper 재사용으로 제한한다. Web·Android 실행 코드와 공유 계약 파일 변경이 없어 APK/Web 제품 배포는 불필요하다.

## 테스트 추적성

| 계약 | 검증 |
|---|---|
| PARSE-KB-001, T-PARSE-001, T-PARSE-TIME-001 | KB 앱 2종, 신용/체크·CRLF·Clock, 일반 안내·잘못된 금액·건수·날짜 거절 |
| ING-006, T-PARSE-001 | 실제 raw 제출 Application에서 KB 앱 2종·SMS 3종의 합계·수신일·번호 없는 카드 증거 전달 |
| CARD-004, ING-SAVE-004 | 실제 Emulator callable에서 본인 카드 미등록 거절, 등록 후 합계 한 건·원장·QuickEdit snapshot, 두 종류 재전송의 중복 억제 |
| CAN-003, CAN-007 | 앞선 매출취소의 가맹점 완전 일치와 분리 lineage 취소 검사도 함께 실행 |

## 검증과 전달

- 수정 전 새 회귀 8개 실패. 수정 후 관련 3개 파일 139개와 테스트 타입 검사 통과. production Functions build·architecture 43개 통과.
- 실제 Auth·Firestore·Functions Emulator와 Chromium에서 후불교통 저장·본인 카드·두 종류 중복 억제, 매출취소·가맹점 불일치 보존·분리 취소 2개 검사 통과(30.7초, production Web build 포함). 에뮬레이터는 정상 종료했다.
- 원문·민감정보는 진단용 TEMP 파일에만 저장하고 소스에는 형식만 사용했다. 기존 운영 지출은 변경하지 않았다.
- Emulator 로그는 `%TEMP%/household-kb-transit-e2e-20261006.log`, 준비 로그는 `household-kb-transit-prepare-20261006.log`, 수정 전 회귀는 `household-kb-transit-before-20261006.log`이다.
- 최종 CI는 push SHA로 후속 확인하고 Firebase 배포는 clean 후보·artifact hash·실제 로그인 smoke로 별도 검증한다.
