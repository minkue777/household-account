# 대전 카드 상품명 가맹점 오인 수정 — 2026-10-11

## 원인과 계약

`PARSE-DAEJEON-001`의 상세 정규식이 `체크카드` 앞 공백을 요구해 `1Q체크카드` 승인을 인식하지 못했다. fallback은 카드 제목을 가맹점으로 선택했다. 기존 농협 형식은 상세 경로로 처리됐으며 운영 원문 12건 재실행과 실제 저장 이력으로 확인했다.

상품명을 분석하지 않고 카드번호·승인·금액·시간·가맹점·잔액의 공통 구조를 읽는다. fallback에서 카드명 헤더를 후보에서 제외하고 중복된 상세 정규식 실행을 제거한다. 기존 줄 단위 fallback과 가맹점 누락 결과, 금액·카드 판정·잔액·재전송 저장 계약은 유지한다. Functions 실행 코드만 변경하므로 Firebase 세 codebase를 배포하며 APK/Web 제품 변경은 없다.

## 운영 영향 조사

사용자가 지정한 가구의 Canonical 원장 현재/원래 가맹점 및 Capture 기록을 기간 제한 없이 조회했다. 잘못된 상품명으로 등록된 지출은 2026-09-24~2026-10-11의 17건, 합계 185,050원이며 모두 active다. 조회 시점의 영향 범위이며 향후 입력은 별도다. 진단 원문은 17개이며 중복 1개를 제외하면 16개 승인이다. 원문이 없는 한 건은 실제 가맹점을 추측하지 않는다.

요청 범위는 파서 수정과 건수 확인이다. 기존 지출·Capture·금액·메모·태그·분류·잔액을 수정하거나 원문을 운영 서버에 재전송하지 않는다. 원문·개인 식별자는 TEMP의 `household-ontong-all-impact-20261011.json`에만 보관한다.

## 테스트 추적성

| 계약 | 검사 |
|---|---|
| PARSE-DAEJEON-001, T-PARSE-001 | `daejeon-card-name.contract.test.ts`: 세 카드명, text/bigText/textLines/CRLF, 제목 오인 방지, 기존 fallback, 충전 부족 안내 |
| T-PARSE-001, ING-SAVE-004, BAL-002 | `payment-capture.spec.ts`: 실제 Emulator callable에서 1Q·농협 승인, 원장·Capture·QuickEdit·잔액 저장, 같은 observation 재생과 새 observation 중복 억제 |
| 기존 공급자·SMS 순서 계약 | 기존 parser golden 및 SMS 순서 회귀 |

수정 전 새 회귀 4개 실패를 확인했고 수정 후 관련 3개 파일 122개·테스트 타입 검사·architecture 43개·추적성 12개를 통과했다. 실제 Auth/Firestore/Functions Emulator와 production Web build를 사용하는 Chromium 검사 1개도 통과했다(53.4초). 에뮬레이터 검사 로그는 TEMP의 `household-daejeon-e2e-20261011.log`, 준비 로그는 `household-daejeon-prepare-20261011.log`다.

기존 운영 원문 30개를 수정 전후 공개 parser로 비교했다. 1Q 진단 15개는 가맹점명만 교정됐고 농협 승인 12개·안내 3개는 결과 전체가 동일했다. 17개 영향 지출 중 16개는 날짜·시각·금액·카드번호가 일치하는 원문에서 실제 가맹점을 재확인했다. 2026-10-09 10:25의 5,200원 한 건은 원문이 없어 추정 대상에서 제외했다. 배포는 clean 후보의 Firebase wrapper와 로그인 smoke로 확인하고 전체 CI는 정확한 후보 SHA의 후속 확인으로 추적한다.
