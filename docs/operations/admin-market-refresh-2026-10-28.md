# 관리자 조회의 자산 시세 갱신

## 요청과 원인

관리자 접속에서도 자산을 갱신하도록 요청했다. 기존에는 AssetsPage가 관리자 진입 갱신을 생략하고, Web command client가 모든 tenant command를 차단하며, 서버 refresh handler는 대상 가구 Membership만 허용했다.

## 변경 계약

- ADM-004/T-ADM-003, JOB-AST-001: 관리자 조회도 첫 서버 자산 snapshot 후 전체 시세를 한 번 갱신하며, 기존 개별 시세 갱신 버튼을 사용할 수 있다. 체류 중 반복 갱신은 추가하지 않는다.
- 기존 `portfolio.refresh-market-values.v1`에만 관리자 실행을 허용한다. Firebase가 검증한 systemAdmin claim과 같은 UID의 주체, `portfolio.market.refresh` capability, active 가구를 확인한다. wire payload·클라이언트 accessMode가 관리자 권한의 근거가 되지 않는다.
- 기존 시세 Application의 lease·cooldown·재전송 멱등·version 충돌 검사·원자적 평가액 저장을 사용한다. 수량·원금·명의·메모 편집, 자산 삭제, 알림 endpoint 등록 권한은 확대하지 않는다. receipt의 관리자 식별은 `administrator:<principalUid>`이며 가구 Member/Membership을 만들지 않는다.
- Web은 현재 선택 가구와 요청 scope 일치를 계속 검증한다. 일반 회원의 기존 명령·권한과 wire 계약은 유지한다.

## 검증

- Functions Router·등록·관리자 시세·claim 검사 4파일 25개 통과. Quote port만 고정하여 운영 Router/Application/Firestore adapter로 실제 가격 500→700원, 2주 평가액 1,000→1,400원 저장과 수량·메모 보존, 멱등·cooldown·권한 거절을 확인했다.
- Web command client·AssetsPage 2파일 18개 통과. 관리자/회원 모두 캐시 snapshot에서는 갱신하지 않고 첫 서버 snapshot 후 한 번만 실행한다.
- Functions/Web TypeScript 통과, E2E 준비 architecture 43개 통과.
- 실제 Auth/Firestore/Functions Emulator와 production Web build의 관리자 브라우저 검사 1개가 통과했다(33.0초, 실제 시나리오 11.8초). 예수금 계좌로 자동·개별 갱신 callable, 비회원 일반 사용자 거절, 관리자 자산 삭제 거절, 잔액·메모·Membership 부재를 확인한다. 외부 가격 제공 자체는 이 브라우저 검사의 범위가 아니다.
- 첫 E2E 준비 데이터에 예수금 `stockCode: ''`가 누락되어 `POSITION_INSTRUMENT_REQUIRED`로 거절됐다. UI의 실제 등록 계약대로 fixture를 보정했으며 검증 범위는 유지했다.
- 두 번째 실행에서는 자동으로 `네`가 붙는 가구 이름 정규화를 locator가 고려하지 못했다. 기존 관리자 E2E와 같이 실제 저장된 가구 이름으로 행을 선택하도록 수정했다.
- 세 번째 실행은 관리자 화면 자동 갱신까지 성공했지만 예수금 전용 계좌에는 원래 수동 시세 버튼이 없으므로 잘못된 버튼 대기에서 실패했다. 버튼 부재를 확인하고 같은 관리자 token으로 개별 범위 callable 권한을 검증하도록 분리했다. 가격 갱신·수량 보존 검사는 서버 계약에서 유지한다.
- 로그: `%TEMP%/household-admin-market-prepare-20261028.log`, `household-admin-market-e2e-20261028.log`, `household-admin-market-e2e-20261028-r2.log`, `household-admin-market-e2e-20261028-r3.log`, `household-admin-market-e2e-20261028-r4.log`.

## 배포

Functions 세 codebase를 먼저 배포한 뒤 main push로 Vercel Git 배포를 진행한다. Android 실행 파일과 공용 wire 계약은 변경하지 않아 APK는 재발행하지 않는다. 운영 금융 데이터의 직접 수정이나 진단용 갱신은 실행하지 않는다. 전체 CI 결과는 해당 commit의 다섯 검사와 요약을 별도로 추적한다.
