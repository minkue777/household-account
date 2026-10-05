# 서버 입력 경계 정비

최종 대조에서 진행표에 빠졌던 서버 경계 보고서 SB-01~04를 처리했습니다.

- 미사용 server NotificationIngress·recent cache·portfolio demo를 제거했습니다. 실제 Android journal과 서버 receipt, envelope 본문 선택은 유지합니다.
- 진단 application/store의 전체 조회와 별도 역할 인가 모형을 제거했습니다. 실제 callable은 인증된 가구·멤버로 수집하며 진단 읽기 인가는 기존 Firestore Rules의 systemAdmin claim이 담당합니다. 일반 멤버 거부·시스템 관리자 읽기·직접 쓰기 거부를 실제 Rules 검사에 연결했습니다.
- 사전 성공 ID 배열만 정렬하던 SMS policy·port·fixture를 제거했습니다. 실제 parser에 겹치는 KB/NH 문자, 카드/청구 문자, 미일치 문자, 여민전 문자를 전달해 순서·중단·fallback을 검사합니다. 실제 공급자 함수를 통과하는 spy는 호출 순서만 관측합니다.
- 이 과정에서 세종 여민전 문자가 경기지역화폐로 해석되는 오류를 재현했습니다. 전용 앱 package가 없는 SMS 경계에서 지역화폐 서비스명 확인을 추가했습니다. 일반 금액·잔액만으로 지역을 추정하지 않으며, 전용 앱 파싱과 유효한 경기·대전 SMS 처리는 유지합니다.
- 자산·보유종목의 필수 expectedVersion을 optional처럼 다시 조립하던 분기를 제거했습니다. 필수 값 검증과 version 충돌은 그대로입니다.
- 수동 등록의 알 수 없는 transactionType을 지출로 취급하던 분기를 고쳤습니다. expense/income만 실행하며 잘못된 문자열은 TRANSACTION_TYPE_INVALID, 타입 누락·비문자열은 기존 TRANSACTIONTYPE_REQUIRED로 저장소 접근 전에 거부합니다.

## 검증

새 수동 유형 검사는 수정 전 실패했고 실제 SMS 여민전 검사도 기존 오분류를 재현했습니다. 수정 후 command·진단·SMS·공급자 golden 6개 파일 109개와 전체 Functions 타입 검사가 통과했습니다. 실제 Firestore Rules·진단 저장 2개 파일 17개도 통과했습니다. 수집·저장·읽기 권한과 실패 의미를 가짜 상태기계로 대신하지 않습니다.

로그: `TEMP/household-simplicity-server-boundaries-{red,unit,types,sdk}-20261005.log`.
