# 요구사항·계약 기반 반복 호출 최적화

## 기준과 배포 상태

사용자가 기존 개선분을 먼저 push하고 다음 최적화를 계속하도록 요청했다. 기존 개선 55개 파일은 `c764437823af2c00277889dd1861c0b60a13f53c` (`시세·지출 저장과 원장 갱신 성능 최적화`)로 main에 push했다. 앞선 세 최적화 문서의 미커밋·미배포 표기는 그 문서를 작성한 로컬 검증 시점의 상태다.

Git 연동 Vercel 배포 `dpl_B6vEsyXC1WMwzmE2a6p4ZyJZe8PG`가 Ready이며 운영 주소 `https://household-account-app-demo-v1.vercel.app/`에 연결됐다. 운영 페이지와 `/sw.js`는 HTTP 200을 반환했다. 별도 CLI 업로드는 실행하지 않았다. Git push는 Firebase Functions 운영 반영이나 Android APK 릴리스를 수행하지 않는다.

정확한 위 HEAD의 [품질 게이트 실행 34127795734](https://github.com/minkue777/household-account/actions/runs/34127795734)은 Functions, Web, Web E2E, Android, Android instrumentation 5개 job 모두 성공했다.

이 문서 아래의 후속 변경은 위 커밋 이후의 로컬 작업이다. 실행 횟수 및 합성 지연 비교를 운영 성능 실측과 구분한다.

## 검토 근거

| 경로 | 요구사항·계약 | 발견한 중복 또는 대기 | 조치 |
| --- | --- | --- | --- |
| 결제 알림의 거래·잔액 처리 | `ING-009`, `BAL-005`, Android 결제 수집 design 7.2, `capture-envelope.v1` | 독립 Port와 독립 receipt인데 거래 완료 뒤 잔액을 시작 | 두 branch를 함께 시작하고 양쪽 결과를 얻은 뒤 root receipt 한 번 저장 |
| Capture root 최종 저장 | Android 결제 수집 design 7.2의 compare-and-set·결과 재생 | completed 후보가 무조건 update되어 늦은 요청이 최초 확정 결과를 덮을 수 있음 | transaction 안에서 결과 병합, 최초 terminal 결과 보존, 저장된 결과로 응답 |
| 지역화폐 재생·오래된 관찰 | `BAL-002`, `BAL-005`, `HOME-002` | 잔액을 바꾸지 않는 경우에도 홈 설정과 전체 유형을 미리 조회 | 실제 `saveBalance`에 진입할 때만 같은 transaction 안에서 홈 선택 준비 |
| 카테고리 수정·예산 설정 | `CAT-002`, categories-budget design의 변경 필드 계약 | handler의 전체 catalog 조회 뒤 transaction이 같은 catalog를 다시 조회 | 후속 후보로 기록, 이번 구현에는 포함하지 않음 |

요구사항의 목표 명세와 실제 사용자가 요청한 변경을 구분했다. 과거 통계 소유자 필터나 홈 카드 구성 목표 문구를 근거로 사용자가 삭제 요청한 UI를 다시 추가하지 않았다. 외부 wire schema·version·branch key는 바꾸지 않는다.

## 지역화폐 조회 감소

`FirebaseLocalCurrencyBalanceStore`의 홈 선택 준비를 transaction 진입 시점에서 실제 잔액 저장 직전으로 옮겼다. 동일 transaction 시도에서는 Promise를 공유하고 재시도에서는 새 snapshot을 읽는다. 모든 홈 조회는 첫 write보다 먼저 끝나며 기존 자동 선택 함수가 정책을 계속 단독 소유한다.

기준 커밋의 실제 Adapter와 새 Adapter를 동일 Application 및 메모리 Firestore에 연결해 비교했다. 생성·재생·payload 충돌·오래된 관찰·갱신의 응답이 모두 동일했다.

| 처리 | 이전 read API | 이후 read API | 이후 범위 query |
| --- | ---: | ---: | ---: |
| 최초 잔액 생성 | 6 | 6 | 2 |
| 같은 observation 재생 | 5 | 1 | 0 |
| 같은 key의 다른 payload | 5 | 1 | 0 |
| 오래된 관찰 무시 | 6 | 2 | 0 |
| 새 관찰로 잔액 갱신 | 6 | 6 | 2 |

실험 산출물은 로컬 임시 디렉터리의 `requirements-local-currency-benchmark-20260907.cjs`와 `.json`이다. 수치는 API 호출 횟수이며 단말의 로딩 시간이나 Firestore 과금 읽기 수를 측정한 값이 아니다.

0원도 유효한 최초 잔액이다. 첫 단일 유형 자동 선택, 이후 다른 유형 추가 시 선택 유지, receipt 재생의 write 0, stale 처리의 receipt만 저장, 잔액·홈 선택·이벤트·receipt의 원자성을 보존한다.

## 거래·잔액 분기와 최종 결과

인증과 root payload claim이 끝난 뒤 존재하며 아직 terminal이 아닌 branch만 시작한다. 거래와 잔액은 각자의 application에서 처리하고 결과를 따로 보존한다. coordinator가 공용 mutable receipt를 두 작업에서 갱신하지 않고 반환값을 모아 한 번 조합한다. 한 branch만 완료된 시점에는 root 저장이나 응답을 하지 않는다.

거래 Port의 예외는 기존 결과 타입의 `LEDGER_UNAVAILABLE`로, 잔액 예외는 `BALANCE_REPOSITORY_UNAVAILABLE`로 표현한다. 다른 branch의 확정 결과를 실패로 바꾸지 않으며 partial receipt 이후 재시도에서는 terminal branch를 다시 호출하지 않는다. root 저장 실패로 재전송하더라도 기존 downstream key를 유지한다.

일반 Android 승인 단독 경로는 기존 Ledger 원자 receipt만 사용한다. iOS Shortcut의 정상 입력은 schema가 잔액 branch를 허용하지 않으므로 분기 병렬화에 의한 지연 감소 대상이 아니다.

root receipt 저장은 현재 문서의 fingerprint·identity·branch key를 확인하고 terminal 결과를 최초 값으로 고정한다. 두 요청의 partial 결과가 합쳐 양쪽이 terminal이 되면 completed로 확정한다. 이미 completed이면 저장과 TTL 갱신 없이 기존 결과를 반환하며 coordinator도 이 저장된 결과로 응답한다.

이 정확성 보완으로 이전의 무조건 completed update에 비해 정상 root 최종 저장에는 transaction read 1회가 추가된다. 병렬 branch 처리의 시간 절약과 별도 비용이므로 운영 응답 시간이 절반으로 줄었다고 주장하지 않는다.

기준 커밋과 새 실제 coordinator에 동일한 거래 100 ms·잔액 100 ms의 가상 지연을 주면 분기 처리 시간은 200→100 ms, 시작 시각은 `[0, 100]`→`[0, 0]`, 최대 동시 branch는 1→2였다. claim 1회·최종 save 1회 및 응답·최종 receipt 전체는 동일했다. root 저장소의 CAS read 지연을 제외한 분기 비교다. 실험 산출물은 로컬 임시 디렉터리 `capture-composite-benchmark-20260907/results.json`과 `benchmark.log`다.

## 다음 검토 후보

카테고리 수정·예산 설정은 변경하지 않은 필드를 채우려고 handler에서 catalog를 미리 읽고 저장 transaction에서 다시 읽는다. 일반 stable ID 수정의 read API는 11회이며 사전 조회를 없애면 6회가 될 여지가 있다. 다만 legacy 물리 document ID를 stable category ID로 바꾸는 호환 처리와 version·오류 우선순위를 transaction 내부에서 함께 정리해야 한다. 조회만 제거하거나 alias 처리를 건너뛰지 않는다.

## 검증과 검증 중 수정

- 최종 `npm --prefix functions run test:quality-gate`: 321개 suite / 2,836개 통과. 별도 Emulator·Rules·Callable 실행용 81개는 일반 unit 실행에서 skip했다. 테스트 타입, 런타임 경계, architecture 38개, production build 모두 통과했다. 최종 로그는 `requirements-optimization-functions-gate-final.log`다.
- 결제 coordinator·receipt 관련 기존 5개 suite 46개와 지역화폐 관련 4개 suite 31개 통과. 결과·버전·branch key·실패 전파·재생 불변성을 확인했다.
- 실제 Firestore Emulator: `npm --prefix functions run test:firebase-integration` 13개 suite / 64개 통과. 새 검증은 Capture 동시 최종 결과 보존·최초 TTL 고정 1개, 지역화폐 두 유형 동시 최초 등록·replay/stale 1개, 모든 write 준비 후 abort·동일 요청 재시도 1개다.
- 독립 코드 리뷰에서 추가 blocking 결함은 발견되지 않았다. Web·Android 소스와 wire schema는 후속 작업에서 변경하지 않았다.

새 Home 이벤트 테스트는 최초 실행에서 실패했다. 실제 Outbox가 `eventType: HomeConfigurationChanged`, `eventVersion: 1`로 분리 저장하는데 테스트가 `.v1` 포함 문자열을 기대한 오류였다. 기대값을 물리 계약에 맞추고 이벤트 개수와 version을 함께 검사했다. 제품의 이벤트 형식은 변경하지 않았다.

별도로 수정하지 않은 자산 자동화 동시성 테스트가 전체 기본 worker 실행에서 두 번 `retryable-failure`를 반환했고, Emulator 로그에 lock timeout·invalid/closed transaction이 있었다. 같은 코드의 GitHub CI와 단독 suite 5개는 통과했다. 전체 파일 worker만 2개로 제한하면 모든 64개가 통과해, `FIRESTORE_EMULATOR_HOST`가 있는 경우에만 Vitest 파일 worker를 2개로 고정했다. 단일 로컬 Emulator에 대한 파일 간 동시 부하를 줄인 것으로, 테스트 안의 동시 요청·transaction 경합·검증 조건·테스트 수는 그대로다. 설정 후 원래 `test:firebase-integration` 명령도 64개 모두 통과했다. 제품 코드를 바꾸거나 assertion을 약화하지 않았다.

실험·실패 진단·최종 통합 검증 로그는 임시 디렉터리의 `requirements-optimization-firebase-integration.log`, `requirements-optimization-firebase-integration-final.log`, `requirements-optimization-automation-isolated.log`, `requirements-optimization-firebase-bounded-final.log`, `requirements-optimization-firebase-active-command.log`에 남겼다.
