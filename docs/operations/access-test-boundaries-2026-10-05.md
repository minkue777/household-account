# 가구 접근 검사의 실제 실행 경계

PT-02를 처리했습니다. 서버 fixture가 직접 localStorage를 삭제하거나 세션·clipboard effect·재로그인 결과·다른 가구 가입 결과를 만들어 내던 부분을 제거했습니다. 단위 검사는 서버 application 결과만 확인하고, 다른 가구 claim은 충돌 검사의 명시적 준비 자료로만 넣습니다. 불변 상수였던 legacy 금융 자료 지문도 제거했습니다.

대체 검사는 실제 소비자를 실행합니다.

- `androidHouseholdServerFirst.contract.test.tsx`: 실제 HouseholdProvider와 실제 legacySessionCandidate/Storage가 완전 후보를 읽고, claim 실패 시 보존하며 성공 시 이전 키만 삭제하고 검증된 세션으로 전환합니다. 별도 preference를 보존합니다.
- `adminCreationCopy.contract.test.tsx`: 실제 AdminPage가 clipboard API를 호출하고 복사 실패와 생성 실패를 구분합니다.
- `firebase-access-command-adapters.integration.test.ts`: 실제 Admin/가입 handler와 Firestore transaction으로 removed UID의 복구와 다른 가구 가입을 동시에 실행합니다. 한 명령만 성공하고 다른 명령은 PRINCIPAL_ALREADY_JOINED, canonical claim 하나와 실제 로그인 조회의 동일 binding을 확인합니다. 기존 legacy 연결의 금융 원본 보존도 유지합니다.
- `firebase-access-operations.integration.test.ts`: 실제 단계별 purge가 기존 사용자 Membership view를 제거한 뒤 실제 로그인 resolver가 첫 방문을 반환하는지 확인합니다.

검증: 서버 단위 4개 파일 45개, Web 2개 파일 24개, 실제 SDK 가입 6개·purge 7개 및 Functions/Web TypeScript 통과. SDK 로그는 `TEMP/household-simplicity-access-boundaries-20261005.log`, `TEMP/household-simplicity-purge-resolver-20261005.log`입니다.

Web TypeScript 검사에서 카테고리 회귀 검사의 `getByRole`에 지원하지 않는 `exact` 옵션이 남은 것을 발견해 제거했습니다. role name 문자열의 기본 일치 규칙은 그대로이며 assertion을 줄이지 않았습니다. 이번 변경은 검사 및 테스트 전용 타입 정비로 제품 동작 변경이 없습니다.
