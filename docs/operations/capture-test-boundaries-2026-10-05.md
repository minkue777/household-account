# 수집 검사 경계와 receipt 저장 정비

FT-01·FT-02·CT01~04의 완료 기록입니다. 수집 조율 fixture의 별도 금융 엔진을 제거하고 실제 저장 경로에 검사를 연결했습니다.

## 계약별 변경

- 카테고리의 공개 명령 부재는 fixture의 문자열 목록 대신 실제 bootstrap registry 전체 카테고리 명령을 검사합니다(T-CAT-003). 자산 삭제의 상수 0 관측은 실제 portfolio runtime store의 원본·보유종목·이력 보존 검사로, reconciliation의 상수 빈 provider 호출은 실제 Outbox production flow의 provider Spy로 귀속합니다.
- 인증정보 fixture의 상수 빈 로그/원문 배열과 가상의 strong-hash 라벨을 제거했습니다. 실제 HMAC adapter와 Firestore에 연결한 `shortcut-credential-rotation.integration.test.ts`가 최초 발급·겹친 재발급·승자 재전송·구 인증 거부·신 인증 허용·commit 전 실패 rollback을 검사합니다. 원문 부재는 실제 credentials·subject pointers·operationReceipts와 실행 중 관측한 console 로그에서 확인합니다. 이 검사를 모든 HTTP 로그 경계의 완전한 증명으로 부르지 않습니다.
- Promise.all 내부의 await를 제거했습니다. 메모리 대역의 중첩 호출 검사와 실제 Firestore 경합 검사를 구분합니다(T-IOS-SEC-002).
- Capture 조율은 실제 application과 downstream 응답 Spy로 분기 독립성·인가·충돌·실패한 분기만 재호출·최초 terminal 보존을 검사합니다. fixture가 직접 만들던 거래·취소 fingerprint·원장·잔액·Event 엔진 두 개를 삭제했습니다. payload 해시는 운영 Sha256CapturePayloadFingerprint를 그대로 사용합니다.
- 실제 Capture→Gateway→Firebase 원장·잔액·receipt·Outbox 검사로 같은 root 동시 요청, 서로 다른 payload 경합, Android/iOS 교차 채널 중복, 없는 취소 뒤 승인, 성공 취소 재생, 잔액 실패 뒤 성공과 재전송을 확인합니다(T-IOS-001, T-DUP-001, T-CAN-002, T-CAPTURE-LINEAGE-001, T-BAL-008, T-ING-BAL-001).
- golden expected를 다시 읽어 정답을 주장하던 검사를 제거했습니다. 모든 golden 입력의 실제 parse 결과 전체 비교와 시간·출처를 변경하는 행동 검사는 유지합니다. fixture 공급자/ID coverage는 자료 구성 검사로 명시합니다.

## 실제 SDK에서 발견한 결함과 수정

`FirebaseCaptureSubmissionReceiptStore.save`의 merge:true가 nested result를 재귀 병합했습니다. balance retryable의 code가 다음 recorded 결과에 남아 첫 성공 응답과 재전송 응답이 달랐습니다. 이미 존재하는 receipt를 transaction.update로 저장해 transaction/balance 필드를 통째로 교체합니다. 현재 receipt 판정·최초 terminal CAS·TTL·identity 검사는 유지합니다. 응답 필드를 사후 삭제하는 예외 처리는 추가하지 않았습니다.

실제 Outbox의 중복 알림은 iOS가 중복을 감지한 경우에만 추가됩니다. 지역화폐 최초 저장에는 홈 기본 선택 Event도 있습니다. 기존 fixture가 빠뜨리던 동작을 실제 계약에 맞춰 함께 검사합니다.

## 검증

- registry/카테고리/자산/알림/인증/golden 관련 7개 파일 174개를 검사했습니다. 인증 hash 관측형 변경에 따른 마지막 소비자도 수정한 뒤 해당 파일 20개를 재검사했습니다.
- receipt adapter와 조율 2개 파일 30개 통과, Functions 전체 타입 검사 통과.
- 실제 Firestore 인증정보 교체 1개 통과; 수정 전 실제 잔액 retry 성공→replay 불일치 재현.
- 수정 후 실제 Capture 금융 경로 5개와 receipt CAS 1개 총 6개 통과. 실제 LocalCurrency 저장의 동시성/rollback 2개는 별도 선행 실행에서 통과했습니다.
- 로그: TEMP/household-simplicity-{credential-sdk,capture-sdk-fixed,capture-orchestration}-20261005.log.

앞선 설치 등록·수집 인가 변경 0c7da44는 Firebase release-20261005-simplicity-endpoint-0c7da44의 세 codebase 배포와 인증 Query smoke를 완료했습니다. 이번 receipt 수정은 다음 서버 후보 배포에 포함합니다.
