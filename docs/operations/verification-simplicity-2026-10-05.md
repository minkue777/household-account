# 검사 경계 정비

## Native 범위와 런타임 보안 (TOOL-01/06)

Native가 소비하는 `tools/e2e/`와 범위 판정 자체를 포함하는 `tools/ci/`는 디렉터리 단위로 포함합니다. 개별 helper 파일 allowlist를 줄였으며 저비용 명령 보류·로그 parser unit은 emulator 범위와 관계없이 항상 실행합니다. Web 화면·문서만 바뀌면 emulator를 생략하는 정책과 push 전체 diff/PR merge-base/삭제·rename/알 수 없는 diff 실패 처리는 유지합니다.

Runtime boundary gate에서 완료된 과거 폴더 이전 조건만 제거했습니다. Web/Android의 Firestore 직접 쓰기 차단은 그대로 검사합니다. 범위 표 31개, 실제 helper 9개 통과, runtime boundary 위반 0개입니다.

## PWA CI 관측

`3a70b60`의 CI 37252963971은 Web 단위 923개와 production build가 통과했으나 PWA 6개 중 활성화 1개가 실패했습니다. lifecycle 첨부는 올바른 버전 전송 후에도 기존 controller/active와 installed waiting 후보를 보여줍니다. 후보 교체나 active 역행 근거는 없으며 메시지 수신·skipWaiting·기존 extendable event 중 어디서 지연됐는지는 해당 기록만으로 확정할 수 없습니다.

실제 worker의 message/skipWaiting 호출·완료와 pending waitUntil Promise를 관측하는 검사 보조 도구를 추가했습니다. 원래 메서드와 Promise를 그대로 호출/반환하며 시간·응답·worker를 대체하지 않습니다. 성공 시 실제 수신/호출/완료 관측을 assertion하고 실패 시 pending event를 첨부합니다. 15초 기준과 handshake/잘못된 버전 거부는 유지합니다. 로컬 실제 production build와 Chromium 단일 검사는 통과했습니다. 과거 CI 실패를 재현하거나 제품 원인을 수정한 것으로 해석하지 않습니다.

로그: TEMP/household-simplicity-ci-web-37252963971.log, TEMP/household-simplicity-pwa-observation-build-20261005.log, TEMP/household-simplicity-pwa-observation-20261005.log. 이전 실패 trace: TEMP/household-simplicity-pwa-37252963971.
