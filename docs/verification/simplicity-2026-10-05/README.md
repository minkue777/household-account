# 기능 계약별 Simplicity 정비

기준: 2026-10-05, `12a582bf63bae7ad5b7c66bcfbf67ac96fb338da`.

**저장소 코드 전수 정적 검토를 완료했다.** 제품 코드·테스트·도구·실행 설정·wire 계약 1,557개의 본문을 읽고 실제 호출 경로와 연결했다. 기능 계약별로 삭제 후보, 복잡성의 원인, 더 작은 구현 방향, 보존할 동작과 필요한 검증을 기록했다. 이번 단계에서 제품 구현·운영 데이터·배포는 변경하지 않았으며 테스트를 실행하지 않았다. 정비 방향은 루트 [AGENTS.md](../../../AGENTS.md)에도 반영했다.

## 정비 기준

같은 기능을 더 적은 개념·상태·분기로 설명하는 것이 목표다. 줄 수, 공통 함수 수, 레이어 수를 성과로 삼지 않는다. 기존 Clean Architecture의 Port·Facade·Subject 형태도 검토 대상이다.

- 기능의 입력 → 결과 → 실패 → 저장 계약을 한 단위로 다룬다. 파일 이동이나 전역 이름 변경을 별도 성과로 삼지 않는다.
- 버그를 만든 데이터 소유권과 판정 위치부터 고친다. 원인이 사라지면 보완 분기·예외·중복 상태도 함께 제거한다.
- 실제 호출되지 않는 구현, 통과만 하는 테스트 모형, 사용하지 않는 인자는 삭제 후보로 둔다.
- 인증·원자성·멱등성·데이터 보존·구버전 호환의 필요성이 확인된 코드는 남긴다. 모든 방어 코드를 AI slop으로 취급하지 않는다.
- 범용 프레임워크를 새로 만들기보다 현재 기능을 직접 표현한다. 주식과 코인, 수정과 분할처럼 실패 계약이 다르면 억지로 합치지 않는다.

## 핵심 발견과 작업 순서

| 순서 | 정비 방향 | 확인한 근거 | 실행 단위 |
|---|---|---|---|
| 1 | 계약을 실제로 관측하는 테스트로 정리 | 삭제 횟수 `0`, 비밀값/전송 로그 `[]`, 명령 목록 상수를 반환하는 fixture; 순차 실행하는 경합 검사 | 자산 삭제, credential 회전, 알림 복구를 각각 별개 변경으로 처리. 기존 실제 저장/전송 검사는 유지. [FT-01](finance-tests.md), [CT01/02](capture-tests.md), [PT-03](platform-tests.md) |
| 2 | 운영에 연결되지 않는 구현과 API 제거 | 서버의 클라이언트 세션 모형·중복 Safe HTTP 모형·미연결 demo; Android 미사용 단건 전송; Web 분할의 미사용 삭제 인자 | 세션 복원 / 외부 HTTP / Android 수집 / 월 분할을 각각 한 계약으로 정리. [A01~03](platform.md), [수집 2](capture.md), [W10](web.md), [SB-01](server-boundaries.md) |
| 3 | 서버가 확정한 자산 저장 결과 반환 | 이미 계산한 결과를 버려 Web이 version·확정값을 재구성하고 여러 상태층으로 보완 | 자산 수정 → 주식 보유 수정 → 코인 보유 수정 순서. [FIN-01](finance.md), [W1](web.md) |
| 4 | 단건 변경에 필요한 자료만 읽기 | 정기 계획 CRUD의 전체 plans/receipts 조회, 가구 application의 무관한 dummy dependency | 정기 계획 생성·수정·삭제, 가구 생성·가입, 이름 변경을 각각 좁힌다. [FIN-09](finance.md), [A04/05](platform.md) |
| 5 | 화면 초안·조회 상태의 소유자 정리 | 반복 초기화, 실패를 빈 보유/0원으로 전달, 수입 편집 시작 version 누락, 이전 종목 시세의 늦은 응답 | 실패 상태 → 수입 수정 → 지출/자산 편집 세션 → 종목 선택 순서. [UI01~05](web-ui.md), [W2~5](web.md) |
| 6 | 실제 경로를 막는 과거 구조·도구 정리 | 테스트 전용 reporting 모형, 정확한 폴더/함수/줄 수 강제, 같은 후보 중복 빌드, Native 도구 영향 범위 누락 | 통계 계약을 실제 경로로 이관한 뒤 모형 삭제; CI 범위·빌드 준비·성능 보고는 각각 분리. [FIN-02](finance.md), [PT-01](platform-tests.md), [TOOL-01~06](tooling.md) |

**첫 제품 정비 단위는 Android 알림 수집의 미사용 단건 전송 API**로 잡는다. 실제 batch 수집 → 암호화 journal → 전송 → QuickEdit FIFO 계약을 유지하면서 호출되지 않는 별도 경로와 전용 인자/테스트만 줄일 수 있다. 이후 위 순서로 진행하되 한 변경에 여러 기능을 묶지 않는다.

위 근거는 소스에서 확인한 구조 또는 결함 후보다. 운영 장애를 재현했다는 의미는 아니다. 특히 자산 응답을 개선해도 관련 구독이 따라오기 전의 확정 overlay·삭제 표시·최초 권위 조회 대기는 필요할 수 있다. 제거 범위는 해당 계약의 회귀 검증으로 정한다.

## 먼저 재현할 계약 불일치

| 기능 | 소스에서 확인한 차이 | 가장 작은 확인 |
|---|---|---|
| 자기 이름 변경 | 정책과 fixture는 다른 멤버 이름을 검사하지만 실제 store는 현재 사용자만 조회 | 같은 가구 활성 멤버 둘의 중복/정상 이름 변경 및 동시 경합. [A04](platform.md), [PT-05](platform-tests.md) |
| 접속 통계 보관 | 메모리 대역은 map을 교체하지만 실제 Firestore merge는 오래된 날짜 키를 남길 수 있음 | 30일 이전 키가 있는 실제 문서 갱신 후 재조회. [A09](platform.md), [PT-04](platform-tests.md) |
| 수입 수정 | 편집 시작 version을 저장하지 않고 저장 시점 최신 version을 사용 | 편집 중 외부 수정 뒤 저장이 충돌로 처리되는지. [UI02](web-ui.md) |
| 종목 선택 | A→B 선택 후 A의 시세 응답이 B 초안을 덮을 수 있는 흐름 | 응답 순서를 뒤집어 B의 종목·가격 일치 확인. [UI05](web-ui.md) |
| credential 회전 검사 | `Promise.all` 안에서 먼저 `await`하여 경합이 일어나지 않음 | 실제 동시 시작과 저장소 CAS 결과 확인. [CT01](capture-tests.md) |

## 기능별 검토 지도

아래 모듈은 탐색용 묶음이다. 실제 정비 단위는 각 행 안의 개별 사용자 동작이다. 모든 후보에는 근거·삭제 범위·보존 계약·검증 방향을 남겼다.

| 기능 | 계약 단위 | 상세 보고서 |
|---|---|---|
| 가구·접근 | 로그인/복원, 생성/가입/초대, 이름 변경, 탈퇴·purge | [플랫폼](platform.md), [플랫폼 테스트](platform-tests.md) |
| 거래 원장 | 생성·수정·삭제, 분할·합치기·복구, 검색·태그 | [재무](finance.md), [Web](web.md), [검증 경계](test-boundaries.md) |
| 카테고리·예산 | 목록·기본값, 추가·순서·삭제, 월 예산 | [재무](finance.md), [재무 테스트](finance-tests.md) |
| 지역화폐 | 잔액 관찰, 취소·차감, 유형 선택 | [재무](finance.md), [수집](capture.md) |
| 정기 거래 | 계획 CRUD, 날짜별 실행·재시도 | [재무](finance.md), [재무 테스트](finance-tests.md) |
| 결제 설정 | 카드 등록·매칭, 가맹점 규칙·기억·순서 | [수집](capture.md), [수집 테스트](capture-tests.md) |
| Android 수집 | raw 수신·내구 queue·전송, 파싱·중복·취소 | [수집](capture.md), [서버 경계](server-boundaries.md) |
| QuickEdit | 표시·수정·분할·태그·Web 즉시 반영 | [수집](capture.md), [Web](web.md), [검증 경계](test-boundaries.md) |
| iPhone Shortcut | credential 발급·회전, 인증·등록·취소·재전송 | [수집](capture.md), [서버 경계](server-boundaries.md), [수집 테스트](capture-tests.md) |
| 자산·명의 | 생성·수정·삭제·정렬, 명의자 | [재무](finance.md), [Web UI](web-ui.md) |
| 보유종목·시세 | position 수정, 검색 목록, 시세·금 평가 | [재무](finance.md), [Web](web.md), [Web UI](web-ui.md) |
| 자산 자동화 | 적금·대출 계산, 예약 실행 | [재무](finance.md), [검증 경계](test-boundaries.md) |
| 분배금 | 공시 수집, 기준일 수량, 계산·반영·정정 | [재무](finance.md), [서버 경계](server-boundaries.md) |
| 알림 | endpoint 수명, 대상 선택, outbox 전송·클릭 | [수집](capture.md), [재무 테스트](finance-tests.md), [Web E2E](web-e2e.md) |
| Android 호스트 | 인증 bridge, lifecycle, 시작 계측, 업데이트 | [수집](capture.md), [Web](web.md), [검증 경계](test-boundaries.md) |
| 홈·PWA | 카드 설정, 초기 조회, worker 등록·갱신, 미저장 입력 | [Web](web.md), [Web 테스트](web-tests.md), [Web E2E](web-e2e.md) |
| 통계 | 기간 지출·자산 조회, 분류 수정, 캐시·최신성 | [재무](finance.md), [Web](web.md), [검증 경계](test-boundaries.md) |
| 외부 작업 | 공급자 HTTP, quota, 결과 분류 | [플랫폼](platform.md), [서버 경계](server-boundaries.md) |
| 배포·검증 | wire 계약, CI 범위, release·smoke·추적성 | [도구](tooling.md), [플랫폼 테스트](platform-tests.md) |
| 공통·이관 | command receipt, 예약 lease, 이관·복구 | [플랫폼](platform.md), [도구](tooling.md), [검증 경계](test-boundaries.md) |

## 범위와 한계

[files.csv](files.csv)는 기준 SHA의 Git 추적 파일에서 코드·테스트·도구·실행 설정·wire 계약을 선별한 전체 목록이다. 1,557개 모두 `본문 전체 읽음`이며 미검토 항목은 없다. 분류 집계는 runtime 902, test 523, tool 40, configuration 62, contract 30이다. helper와 빌드 엔트리 일부는 경로 기준으로 test/configuration에 포함된다.

의존성·생성 산출물·lockfile·이미지·첨부 파일·비밀값·과거 로그는 제외했다. 요구사항과 설계는 관련 계약의 근거로 확인했으며 모든 역사 문서·ADR를 전수 검토한 것은 아니다. CSV는 정적 읽기 이력이며 테스트 성공 목록이나 무결함 보증서가 아니다. 원격 설정·운영 자료·현재 CI는 이번 조사에서 재확인하지 않았다.

## 각 정비 단위의 완료 기준

1. 입력·성공 결과·실패 복구·저장 불변식을 기존 계약과 연결한다.
2. 실제 진입부터 저장·표시까지 가장 작은 경로를 만들고 불필요해진 기존 코드를 함께 지운다.
3. 동적 등록·export·타입·도구 소비자를 확인한 뒤 미사용 코드를 삭제한다.
4. 날짜·금액 정밀도, 권한·원자성·멱등성, 앱 재시작·구버전·동시 수정의 관련 회귀를 실제 경계에서 검증한다.
5. 구버전/이관 fallback은 종료 근거가 있을 때 제거한다. 운영 데이터를 정비 편의로 수정하지 않는다.
6. 변경된 계약의 문서·테스트 추적성을 갱신하고 검증·commit·대상 배포를 완료한다.

이 보고서의 완료 범위는 **전수 조사와 정비안**이다. 이후 제품 변경·검증·배포 진행은 [기능 계약별 정비 실행 기록](implementation.md)에서 추적한다.

후속 구현·검증 결과는 [전체 후보 진행표](completion.md)와 [완료 기록](../../operations/simplicity-completion-2026-10-05.md)에 정리했습니다. 위 본문은 최초 조사 당시의 기록입니다.
