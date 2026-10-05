# 온보딩·가구원·홈 설정의 명령 경계 정비

## 계약과 변경

A05와 PT-03을 처리합니다. HH-003/HH-007의 가구 생성·초대·가입은 필요한 의존성만 받는 함수로 분리했습니다. 가입/초대의 가짜 ID·초기화 함수, 명의 조회/변경의 가짜 ID, 기본 카테고리 초기화의 가짜 재배치 함수를 제거했습니다. 미사용 온보딩 로그인 모형은 제거하고 실제 `resolveFirebaseSignedInUser`의 첫 방문·정상 membership·불변식 검사를 유지합니다.

`FirebaseGoogleOnboardingStore.transact`는 항상 같은 receipt와 identity 원자 저장 계약을 사용합니다. 첫 호출/두 번째 호출을 세어 저장 의미를 바꾸던 필드를 제거했습니다. 초기화 결과는 `finalizeInitialization`이 해당 가구 한 문서를 재검증해 저장하며, 이미 완료된 초기화를 낮추거나 삭제된 가구를 되살리지 않습니다. 같은 저장소에서 생성 재시도도 기존 receipt를 재생하므로 새로 수정한 명의 정보를 덮어쓰지 않습니다. 초대 원문은 여전히 최초 응답으로만 노출하고 receipt에는 넣지 않습니다.

명의 저장의 미사용 members DTO·조회는 제거했습니다. 가구원 제거/복구는 대상 member, 해당 member의 membership/profile, 그 principal claim과 receipt만 읽습니다. 모든 가구원의 문서를 읽어 diff하는 기존 범위를 줄였으며 전체 가구원 제거 허용·동일 ID 복구·다른 가구의 claim 선점 거부는 유지합니다.

홈 설정은 receipt를 먼저 확인합니다. 요약 카드 변경에는 잔액 조회를 하지 않고, 유형 선택은 버전 검사 후 실제 필요한 canonical/legacy 유형 목록을 읽습니다. 두 query는 같은 transaction에서 순서대로 수행하여 한 query의 ABORTED가 다른 query의 닫힌 transaction 오류에 가려지지 않게 합니다. 기존 선택·expectedVersion·receipt·mirror·outbox 원자성은 유지합니다.

## 검증과 추적

- 관련 단위/정책 8개 파일 98개 및 Functions test TypeScript 검사 통과.
- 실제 Firestore/Storage Emulator 5개 파일 17개 통과: 동일 저장소 재시도/실패 초기화 복구/완료 후 늦은 실패/삭제 상태, 초대 동시 소비, 신규 가구 실제 category 초기화, 명의 생성/이름 변경, 가구원 제거/복구 및 로그인 접근, 이름 선점, 지역화폐 최초 선택 경합.
- PT-03: fixture의 `stableReferences`/`ownerReferences` 복사본과 미사용 members 보존 assertion을 제거했습니다. 실제 SDK 검사에서 member/membership 및 자산·과거 snapshot·원장·카드·알림 문서를 저장하고 변경 전후 재조회합니다. 가구원 검사에는 관련 없는 다른 가구원 자료를 추가해 실제 Transaction 응답에 해당 문서가 포함되지 않음과 저장값 보존을 확인합니다.
- 홈 조회 범위 검사는 별도의 adapter 관측 검사입니다. 메모리 대역의 query 호출 여부와 receipt 재생 1회 조회를 확인하며 실제 RPC 비용·동시성 증거로 표현하지 않습니다. 실제 경합/원자성은 위 Emulator 검사에서 확인합니다.
- 로그: `TEMP/household-simplicity-access-read-final-20261005.log`. 운영 자료를 변경하지 않았습니다. 서버 실행 코드가 바뀌었으므로 최종 후보의 Firebase 세 codebase 배포 대상입니다. Web/APK 변경은 없습니다.
