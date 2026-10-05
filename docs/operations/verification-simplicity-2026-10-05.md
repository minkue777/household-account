# 검사 경계 정비

## Native 범위와 런타임 보안 (TOOL-01/06)

Native가 소비하는 `tools/e2e/`와 범위 판정 자체를 포함하는 `tools/ci/`는 디렉터리 단위로 포함합니다. 개별 helper 파일 allowlist를 줄였으며 저비용 명령 보류·로그 parser unit은 emulator 범위와 관계없이 항상 실행합니다. Web 화면·문서만 바뀌면 emulator를 생략하는 정책과 push 전체 diff/PR merge-base/삭제·rename/알 수 없는 diff 실패 처리는 유지합니다.

Runtime boundary gate에서 완료된 과거 폴더 이전 조건만 제거했습니다. Web/Android의 Firestore 직접 쓰기 차단은 그대로 검사합니다. 범위 표 31개, 실제 helper 9개 통과, runtime boundary 위반 0개입니다.

## PWA CI 관측

`3a70b60`의 CI 37252963971은 Web 단위 923개와 production build가 통과했으나 PWA 6개 중 활성화 1개가 실패했습니다. lifecycle 첨부는 올바른 버전 전송 후에도 기존 controller/active와 installed waiting 후보를 보여줍니다. 후보 교체나 active 역행 근거는 없으며 메시지 수신·skipWaiting·기존 extendable event 중 어디서 지연됐는지는 해당 기록만으로 확정할 수 없습니다.

실제 worker의 message/skipWaiting 호출·완료와 pending waitUntil Promise를 관측하는 검사 보조 도구를 추가했습니다. 원래 메서드와 Promise를 그대로 호출/반환하며 시간·응답·worker를 대체하지 않습니다. 성공 시 실제 수신/호출/완료 관측을 assertion하고 실패 시 pending event를 첨부합니다. 15초 기준과 handshake/잘못된 버전 거부는 유지합니다. 로컬 실제 production build와 Chromium 단일 검사는 통과했습니다. 과거 CI 실패를 재현하거나 제품 원인을 수정한 것으로 해석하지 않습니다.

로그: TEMP/household-simplicity-ci-web-37252963971.log, TEMP/household-simplicity-pwa-observation-build-20261005.log, TEMP/household-simplicity-pwa-observation-20261005.log. 이전 실패 trace: TEMP/household-simplicity-pwa-37252963971.


## 단일 문서 파서와 현재 성능 정책 (TOOL-02/05, PT-07)

요구사항 집계·실행 연결·architecture 검사에 흩어진 소유 문서/표 parser를 `tools/requirements/declarations.mjs`로 모았습니다. 정확한 소유 경로·영역 제목·링크 ID·escaped pipe·중복 요구사항/테스트 ID를 검사합니다. TS AST와 Kotlin 실행 메서드 수집은 그대로 유지합니다. parser 2개, 기존 architecture 12개 통과; 요구사항 248개·시나리오 235개와 기존 생성 문서가 동일합니다.

새 성능 측정은 `report-only` 또는 명시적 로컬 `diagnostic`만 사용합니다. 사용자가 폐기한 시간 PASS/FAIL 평가 branch와 그 모드만 검사하던 중복 사례를 제거했습니다. 참고선 숫자·환경 profile은 변경하지 않았습니다. 표본 누락/중복/NaN/잘못된 warmup/미등록 metric/잘못된 profile/CI의 진단 우회는 계속 실패합니다. 50초 표본도 원문과 초과 이유를 보존합니다. 과거 gate JSON을 고정 fixture로 보존해 renderer가 원래 판정·기준을 다시 계산하지 않는지 확인합니다. 정책/HTML 26개, 실제 Playwright reporter subprocess 4개 통과했습니다.

현행 관리자 조회는 최근 24시간 Cloud Logging filter를 사용합니다. 현재 범위 밖인 2026-07-28/29·08-02 사건별 cutoff를 없앴습니다. 요청 범위의 표본 집계, correlation별 최종 재시도, provider 호출 없는 알림 거절 제외 계약은 유지합니다. 관리자 전체 목록 pagination 정비(A10의 나머지)는 별도입니다.

Web 타입 검사의 입력에서 생성된 performance/test report 디렉터리를 제외했습니다. reporter 검사 중 생성·회수되는 임시 spec이 동시에 타입 검사에 잡힌 환경 경합을 없애며 실제 소스·E2E 타입 검사 범위를 줄이지 않습니다.


CI 37254210354의 Functions integration은 131개 중 이름 중복 경합 1개만 5,002ms에 기본 5초 timeout으로 중단됐습니다. 다른 조회/저장 assertion 실패는 없었습니다. 같은 전체 실행의 정기 계획 경합은 6,896ms에 정상 완료됐습니다. 이름 경합 검사는 사용자 지연시간 계약이 아니므로 이 검사 한 개의 수명만 30초로 맞추고 동시 호출·한 건 성공·다른 건 충돌·DB의 유일 이름·Outbox 1건 assertion을 모두 유지합니다. SDK 재시도를 fixture로 바꾸거나 순차 호출로 바꾸지 않습니다.
