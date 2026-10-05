# Web 서버 확정과 구독 경계

## W2: snapshot 출처

공통 projection의 publish는 `server`/`cache`를 필수로 받는다. 원장·자산·종목 listener는 실제 metadata를 전달하고 첫 홈 server read는 server, 보존된 초기 자료와 검색창의 재사용 source는 cache로 전달한다. 삭제 확정을 위해 새 구독의 발행 횟수 >1을 요구하던 가정을 제거했다. 새 구독은 첫 서버 snapshot으로 확정할 수 있으며 여러 캐시 누락은 확정이 아니다. 기존 구독은 명령 시작 이후의 서버 발행인지도 확인한다.

수정·생성 역시 서버 source가 canonical 버전을 관측해야 overlay를 해제한다. 생성 응답보다 오래된 같은 ID cache는 확정값을 덮지 않으며 최신 source는 유지한다. 날짜/유형 이동의 양쪽 조회 확인, Native expectedVersion, FIFO, reset, 삭제 표시의 수명은 유지한다. 기간 원장은 metadata 변경도 수신하며 해제된 구독의 늦은 성공·오류를 폐기한다.

## W3: 실제 쓰는 구독 계약

unknown 인자 배열에서 SDK observer/overload를 해석하고 함수 전체를 이중 cast하던 wrapper를 제거했다. 목록과 문서는 각각 타입이 정해진 함수 하나를 사용하며 options·next·error 위치가 고정된다. SDK 콜백/해제 함수를 그대로 전달한다. permission-denied는 Membership 재확인, unauthenticated는 Android 원격 인증 복구만 요청한다. 네트워크·쿼리·일반 서버 오류는 화면으로 전달하며 인증 복구를 유발하지 않는다.

## 검증

- Web 타입 검사 통과.
- projection/원장/자산/Native Web 피드백 8파일 118개 통과. 캐시 3회 누락, 첫 서버 삭제 확인, Native 수정 중 캐시 누락, 생성 확정과 오래된 같은 ID 자료의 순서 교란 포함.
- 구독/인증/검색/설정 관련 23파일의 182개 중 대역 인자 위치 변경 누락 1개를 교정했다. 해당 검색 파일 58개가 후속 통과했고 다른 22파일 124개는 최초 통과했다. 기대 결과를 축소하지 않았다.
- 실제 Emulator·production build 원장과 자산 브라우저 검사 14개 통과(1.2분). 로그: `TEMP/household-simplicity-web-snapshot-e2e-20261005.log`.
- 로그: `TEMP/household-simplicity-projection-jest-20261005.log`, `TEMP/household-simplicity-listener-jest-20261005.log`, `TEMP/household-simplicity-listener-followup-20261005.log`.

- 전체 기본 Jest 실행은 128파일 958개 중 변경된 문서 구독 mock/metadata 위치에 맞추지 않은 관측 3개가 실패했다. production 실패와 구분하고 mock API를 정정했으며 해당 2파일 19개 후속 통과했다. 나머지 126파일은 최초 전체 실행에서 통과했다. 최종 원격 CI 전체 결과는 별도 추적한다. 로그: `TEMP/household-simplicity-web-all-20261005.log`, `TEMP/household-simplicity-web-all-followup-20261005.log`.
