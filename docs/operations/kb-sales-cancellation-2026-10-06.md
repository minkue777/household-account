# 국민카드 매출취소 알림 파서 — 2026-10-06

## 원인과 범위

9월 28일 120,000원 승인에서 분리한 60,000원 두 건은 원결제 lineage를 정상 유지했다. 10월 6일 받은 `카드매출취소안내`의 `[KB국민카드] 번호 명의자님 가맹점 09/28 이용건 10/06 전체취소(-120,000원)` 형식은 기존 KB parser에서 `Ignored(PARSE_FAILED)`였고, raw 제출은 Capture 호출 없이 terminal로 종료됐다. 운영 원문을 현재 코드로 재현했다.

사용자 요청에 따라 파서만 보완한다. 승인·취소 가맹점이 다른 경우 기존 완전 일치 규칙을 유지한다. 운영 데이터 복구·과거 알림 재전송·별칭 추정은 수행하지 않는다. 테스트는 카드·명의자·가맹점을 비식별 값으로 치환한다.

## 계약과 설계

- 입력: KB 전용 앱의 전체취소 본문. 공용 SMS가 같은 KB parser를 사용하므로 해당 raw 제출 경로도 검증한다.
- 결과: `cancellation`, 양의 원금, 카드 token, 원문 가맹점, 취소일. 이용일을 거래 날짜로 사용하지 않는다. 시각은 기존 서울 수신 시각 정책으로 보충한다.
- 실패: 부분취소·취소예정·양수/중복 부호·0·금액 상한 초과·잘못된 날짜·카드/가맹점 누락은 거래를 만들지 않는다.
- 저장: 기존 Capture envelope·parser version·fingerprint·권한·멱등성·취소 매칭을 유지한다. 가맹점 불일치는 `NotFound`, 완전 일치한 유일 lineage만 분리 자식과 함께 취소한다.
- 구현: KB parser의 기존 분기 앞에 명시적 전체취소 형식 하나를 추가하고 기존 금액·수신 시각·연도 검증을 재사용한다. Web/Android 실행 코드와 공유 스키마는 변경하지 않는다.

## 테스트 추적성

| 계약 | 검증 |
|---|---|
| PARSE-KB-001, T-PARSE-002, T-PARSE-TIME-001 | KB 앱 2종, 지연 수신 취소일, 연말·Clock, 잘못된 금액·날짜·부분취소 등 거절 |
| ING-006, T-PARSE-002 | 실제 raw 제출 Application: KB 앱 2종·SMS 3종에서 취소 observation·원문 가맹점 전달 |
| CAN-003, CAN-007 | 실제 Emulator callable: 가맹점 불일치의 원장 보존과 멱등성, 완전 일치의 항목 분리 전체 취소 |

## 검증과 배포

- 수정 전 새 회귀 8개 실패, 수정 후 관련 5개 파일 138개 통과. Functions 테스트 타입 검사와 production build·architecture 43개 통과.
- 실제 Auth·Firestore·Functions Emulator의 callable→parser→매칭→항목 분리 취소·재전송 검사 1개 통과(Chromium, production Web build 포함). 운영 가맹점명 불일치를 재현한 비식별 입력은 `NotFound`이며 두 지출을 보존했다. 에뮬레이터는 정상 종료했다.
- 로컬 로그: `%TEMP%/household-kb-sales-cancellation-before-20261006.log`, `household-kb-cancellation-prepare-20261006.log`, `household-kb-cancellation-e2e-20261006.log`.
- Firebase plan은 마지막 성공 `45b7e83`부터 누적 변경을 비교해 Functions 세 codebase를 선택했다. 배포 성공은 release provenance·실제 로그인 smoke로 별도 확인하며 Web·APK 배포는 불필요하다. 전체 CI는 최종 SHA로 후속 확인한다.
