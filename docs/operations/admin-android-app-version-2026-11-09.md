# 관리자 Android 앱 버전 표시

## 변경 계약

- 사용자 요청: 관리자 페이지에서 Android 사용자의 앱 버전을 확인한다.
- 기존 Android 알림 등록이 보내는 `deviceInfo.appVersion`과 `lastConfirmedAt`을 재사용한다. APK 변경·재배포나 운영 데이터 보정은 없다.
- 기본 관리자 조회에 Android 등록을 병렬로 읽는 쿼리 하나를 추가한다. projection으로 필요한 필드만 읽고 Cloud Logging 대기와 분리된 경로를 유지한다.
- 활성·미만료 등록을 가구/가구원으로 연결한다. 같은 버전의 복수 기기는 최신 확인 시각으로 합치고, 다른 버전은 모두 표시한다. 등록이 없거나 구 응답이면 ‘확인 안 됨’이며 누락 버전을 임의로 추정하지 않는다.
- 사용자별 접속 표와 가구별 사용자 목록에 버전·서울 기준 확인 시각을 표시한다. 이 정보는 마지막 알림 등록 시 확인된 값이며 오래된 설치 기록이 남을 수 있다.
- systemAdmin 권한은 유지한다. FID·endpoint ID·기기 상세는 응답에 넣지 않는다. 서버 선택 응답 확장을 먼저 배포하고 Web Git 배포를 진행한다.

## 검증

- 서버: 동일 버전 합침, 최신 확인 순서, 가구/가구원 경계, iOS·비활성·만료 제외, 누락 메타데이터와 민감 식별자 비노출.
- Web: 구 응답·빈 기록, 복수 버전, 서울 시각, 누락 버전 표시.
- 실제 Emulator: 앱 등록 명령으로 같은 설치의 버전 변경·복수 기기를 등록하고 관리자 권한 거절, callable 결과, 두 표시 위치를 검증한다. 성능 조회 응답을 보류해도 기본 화면에 버전이 표시되어야 한다.
- 배포와 CI 결과는 아래 완료 기록에 추가한다. 전체 CI 완료와 배포 완료는 구분한다.

## 로컬 확인 결과

- 서버 관련 13개, Web 관련 20개, 실제 callable Chromium E2E 3개 통과. Functions 타입·architecture 43개와 Functions/Web production build 통과.
- 운영 Firestore 읽기 전용 확인에서 3개 가구의 사용자 4명에 연결된 Android 버전 5개를 반환했다. 이전 설치 기록은 7월·9월 확인 값도 포함해 마지막 확인 시각을 함께 표시해야 한다. 데이터는 변경하지 않았다.
- 로컬에서 운영 기본 reader 조회는 956ms였다. Cloud Functions나 실제 브라우저 지연 측정값은 아니다.
- 검증 로그: TEMP `household-admin-version-build-20261109.log`, `household-admin-version-e2e-20261109.log`. E2E build 중 기존 Firebase Auth SSR 경고가 출력됐으나 production build 및 실제 인증·관리자 E2E 모두 exit 0이었다.
- Firebase 세 codebase를 먼저 배포하고 Web Git 배포 후 정확한 SHA의 CI를 후속 확인한다.

## 후속: 최근 버전 하나만 표시

- 사용자 후속 요청에 따라 사용자별 접속 표와 가구별 목록 모두 마지막으로 확인된 항목 하나만 표시한다. 서버가 이미 최신 확인 순으로 정렬하므로 Web의 목록 반복을 제거하고 첫 항목을 사용한다.
- 버전 번호의 최댓값을 선택하지 않는다. 최신 등록의 버전이 없을 때 과거 설치 버전을 대신 표시하지 않으며 확인 시각을 보존한다.
- 응답·저장 계약과 기존 운영 기록은 유지한다. Web Git 배포만 필요하며 Firebase·APK 추가 배포는 없다.
- Web 단위 검사 5개 통과. 기존 실제 등록→관리자 callable→화면 E2E에서 복수 버전 응답을 유지하면서 두 화면 모두 최근 한 버전만 표시하는지 검사한다.
- 이전 제품 `4980c107`의 Firebase 세 codebase·기본 smoke와 Web Git 배포·운영 확인은 완료됐다. CI `42633039332`는 functions·web·android·android-instrumentation 성공, web-e2e 진행 중이며 새 CI와 함께 추적한다.
