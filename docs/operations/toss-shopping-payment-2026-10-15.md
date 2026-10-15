# 토스쇼핑 결제 완료 알림 지원

## 원인과 계약

토스 앱의 `금액원 결제 완료` 제목 / `토스뱅크 ・ 토스쇼핑` 본문은 기존 체크카드·페이스페이의 `|` 구분자와 다릅니다. 기존 파서가 가맹점을 찾지 못해 지출 분기를 생성하지 않았습니다.

- 입력: 토스 앱의 금액·완료 제목과 바로 다음 토스뱅크·가맹점 줄. 기존 textLines → bigText → text 우선순위를 사용합니다.
- 결과: 가맹점과 결제 원금, 서울 수신일·시각, 토스 결제수단을 기존 승인 흐름에 전달합니다. 적립 안내는 차감하지 않습니다.
- 실패: 실패·예정·입출금·금액 없는 취소·다른 결제수단·빈 가맹점은 새 승인 형식으로 인정하지 않습니다. 가승인·금액 범위와 본인의 토스 등록 검증을 유지합니다.
- 저장: 기존 원장·Capture·원승인 총액·QuickEdit·receipt·fingerprint를 사용합니다. 동일 원문 재전송과 새 observation의 동일 거래는 중복 생성하지 않습니다.
- 범위: 서버 parser 변경입니다. 삼성월렛·교통카드 출금·취소 매칭 정책과 Web·APK 실행 코드는 변경하지 않습니다.

## 검증과 추적성

| 계약 | 검사 | 확인 |
|---|---|---|
| PARSE-TOSS-001 / T-PARSE-001·002 | toss-payment-complete.contract.test.ts | 표시 필드·줄바꿈, 원금·가맹점·시각, 부정 사례·가승인·overflow |
| 기존 공급자 계약 | android-provider-parser-golden.contract.test.ts | 기존 승인·취소·캐시백 처리 유지 |
| CARD-004 / ING-SAVE-004 / ING-008 | payment-capture.spec.ts의 토스쇼핑 검사 | 실제 callable·Emulator에서 미등록 거부, 원장·Capture·QuickEdit와 두 종류 재전송 |

새 계약 검사는 수정 전 6개 실패를 재현했고, 수정 후 공급자 golden을 포함한 121개가 통과했습니다. Functions 타입 검사도 통과했습니다. 실제 저장 경로와 배포 결과는 아래에 기록합니다.

- 실제 callable·Auth/Firestore/Functions Emulator·production Web build를 거친 Chromium 검사가 1개 통과했습니다. production Functions build와 architecture 43개도 통과했고, 로컬 Emulator는 정상 종료했습니다.
- 보존된 토스 알림 전체에 대한 변경 전후 재실행에서 새 완료 형식 16개만 승인으로 바뀌고 기존 파싱 결과는 그대로였습니다. 원문의 가맹점은 토스쇼핑 12개, 여행 예약 4개이며 기존 기록을 일괄 재수집하지 않습니다.
- 로컬 증거: `TEMP/household-toss-shopping-{types,e2e-prepare,e2e,hashes}-20261015.log`, `TEMP/household-toss-shopping-parser-impact-20261015.json`.

## 기존 내역 처리 범위

최근 3개월 감사에서 확인한 토스쇼핑 누락 1건은 원문을 현재 parser와 기존 승인 저장 경로로 재처리합니다. 운영 자료는 저장소 밖에 보관하고 처리 직전 현재 원장·취소·중복 증거를 다시 확인합니다. 추가 사용자 요청에 따라 같은 금액의 수동 기록이 있는 다른 1건도 기존 기록을 삭제하고 원문으로 재등록하되 메모·태그·분류를 보존합니다. 기존 기록 백업, 명시적인 version 확인, 재실행 가능한 명령 키와 저장 후 재조회를 사용합니다. 삼성월렛·다른 소비 알림은 이 작업의 복구 대상이 아닙니다.

- 누락 1건은 실제 현재 membership·parser·카드 설정·승인 저장 경로로 복구했습니다. 동일 원문 재생, 원장·Capture·원승인 총액을 검증했고 기존 1,487개 원장 문서는 내용이 그대로임을 재조회했습니다.
- 교체 대상은 처리 직전 같은 금액·내용의 완료 알림이 다른 두 날짜에 존재함을 확인했습니다. 어느 날짜/건수로 재등록할지 사용자 확인을 요청했고 현재 수동 내역은 보존했습니다. 계획·백업·결과는 `TEMP/household-toss-shopping-reparse-20261015-{plan,result}.json`에 있습니다.

## 전달 상태

제품 후보 `26caa98685dc899a489283817a2ef1007ba96f4a`의 commit·production build·배포 manifest 준비를 완료했습니다. GitHub CLI의 기존 인증이 HTTP 401로 거부되어 push와 Firebase wrapper의 actor 확인이 완료되지 않았습니다. 내장 브라우저의 가계부 로그인 복원도 `auth/network-request-failed`를 반환했고 Google 로그인 갱신 화면을 열어 두었습니다. 서버 배포·CI 완료로 보고하지 않습니다. 인증 후 최종 clean SHA의 manifest를 다시 고정하고 세 codebase 배포와 CI를 진행해야 합니다. Web·APK 변경은 없습니다.
