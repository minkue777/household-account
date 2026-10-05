# Android 수집 전달과 퀵에딧 원본 정비

전수 조사 Capture 3·7의 중복 실행 경로를 정리합니다. 결제 수집 wire, 세션 격리, 72시간 보존, 원본 버전, 태그 누락·명시적 삭제 계약은 유지합니다.

## 한 번의 전달 알고리즘

직접 수집은 후보를 암호화 journal에 일괄 기록한 뒤 `CaptureDeliveryQueue.flush`를 호출합니다. WorkManager도 같은 함수를 사용합니다. 별도의 직접 전달 loop와 retain/complete API를 제거했습니다.

전달 mutex가 HTTP attempt를 직렬화하지만 저장 mutex는 네트워크 중 점유하지 않습니다. 새 알림 저장·로그아웃은 서버 응답을 기다리지 않습니다. HTTP 전과 확정 시 원래 scope·만료·entry를 확인하고 현재 저장 목록의 해당 항목만 교체하여 중간에 들어온 후보를 보존합니다. 로그아웃 뒤 늦은 응답은 후속 효과와 journal을 재생성하지 않습니다. QuickEdit FIFO를 먼저 내구화한 뒤 원래 journal을 확정하며 두 저장소 사이 중단은 기존 transaction ID 중복 방지로 복구합니다.

## 원본 하나와 편집 초안

Activity의 원본 필드 아홉 개를 `LedgerTransactionSnapshot`으로 합쳤습니다. 수정은 `QuickEditDraft`와 원본의 차이만 patch로 보내며, 분할은 현재 입력 전체를 초안으로 고정합니다. 기존 Intent extra 쓰기와 읽기를 같은 파일에 두어 DTO가 바뀔 때 양쪽 경계를 함께 확인할 수 있게 했습니다. 별도 Parcelable·새 서버 계약·중간 저장은 추가하지 않았습니다.

구버전 Intent의 태그 누락은 빈 표시이며 기존 expectedVersion 기본값과 extra 이름은 그대로입니다. 빈 memo·태그 배열은 명시적 삭제이고, 태그 미변경은 patch 생략입니다. 초기 scope가 유효하지 않은 Activity도 원본을 먼저 복원하여 종료 callback에서 미초기화 필드를 읽지 않습니다.

## 검증과 전달

- 관련 Android JVM 16개 suite 109개 통과: HTTP 보류 중 새 기록·purge, 중첩 flush, 취소 후 journal 보존, 원본과 draft 차이, FIFO·태그·즉시 화면 반영 포함.
- 실제 Activity·Keystore instrumentation 19개 통과: Intent round-trip와 구버전 누락 호환 포함.
- 실제 Native Firebase 4개와 Native→Web Chromium 1개 통과: 수집·태그 수정/제거·분할, 서버 전달 전 즉시 반영, version 충돌 rollback 포함.
- Android v1.2.34/code36 release build가 통과했으며 새 서명 APK로 배포합니다. 기존 v1.2.33은 변경하지 않습니다.

서명 검증: APK v2 서명, package `com.household.account`, version 1.2.34/code36, 11,421,547 bytes, SHA256 `a673f95178d40ad5f7a0cdea4c3f9eeab4e36efd109ed5ff160d87ab87269fda`.
