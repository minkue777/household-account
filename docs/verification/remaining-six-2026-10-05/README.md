# 남은 여섯 파일의 네 계약 검토·정비

기준 SHA는 `921ef881ccd84641aa711416cde7f31bfddbfabb`다. 사용자가 분할을 요청한 대상 여섯 파일을 A/B/C/D에 각각 한 번만 배정했다. 이번 기록은 이 여섯 파일의 본문 전체 검토와 필요한 정비를 완료한 근거이며, 프로젝트의 모든 파일을 다시 읽었다는 선언이 아니다.

[파일별 검토 원장](files.csv)은 기준·파일 전체 줄 수·최종 내용의 SHA-256(UTF-8, LF 정규화)·유지/변경 결정·상세 근거를 보존한다. 최초 감사의 기준 파일과 후속 작성 파일을 혼동하지 않도록 이번 고정 범위를 별도로 남긴다.

| 작업 | 독점 대상 | 결과 | 근거 |
|---|---|---|---|
| A 명령·조회 등록 | `householdCommandRegistry.ts`, `householdQueryRegistry.ts` | 단일 항목 임시 Map/래퍼 제거. 조회의 지연 생성·캐시·권한·실패 구분 유지 | [등록 계약](registry.md) |
| B Firestore 저장 대역 | `firestore-double-semantics.integration.test.ts` | 실제 SDK와 중첩 저장 의미를 비교하는 짧은 검사 유지 | [저장 의미](firestore-double.md) |
| C 수집 테스트 입력 | `capture-branch-envelopes.ts`, `capture-submission-command.ts` | 승인 입력을 만든 뒤 취소로 재조립하던 경로 제거. 실제 공개 타입 사용 | [수집 입력](capture-helpers.md) |
| D 과거 성능 자료 | `historical-gate-report.json` | renderer가 읽지 않는 중복 `samples` 제거. 저장된 기준·판정 보존 | [과거 결과 호환](historical-report.md) |

추가 변경 파일은 C의 직접 소비 테스트 두 개와 D의 직접 소비 테스트 한 개뿐이다. 다른 참조 파일은 읽기 전용으로 확인했다. 중복 소유·미배정 대상은 없으며 SDK Emulator의 기동·종료는 통합 담당이 한 번 수행했다.

## 검증

- A: 실제 registry factory와 router 검사 4파일 26개, Functions 실행 타입 검사 통과.
- B/C: Firestore Emulator에서 실제 SDK 검사 2파일 6개와 저장 대역 단위 1파일 3개, 총 3파일 9개 통과(9.74초). 에뮬레이터 정상 종료, skip 0개. 동시 승인·서로 다른 payload 경합·교차 채널 중복·취소·잔액 실패 후 재전송을 확인했다.
- C: 실제 수집 application을 호출하는 기존 조율 계약 6개가 변경 전후 통과했다. 기준/current helper의 승인 입력 10개·취소 입력 2개·정적 envelope 2개가 모두 deep equality로 일치했다. 다른 담당자의 diff 교차 검토에서 계약이나 기대값 약화는 발견하지 못했다.
- D: 직접 소비 Node 검사 13개가 변경 전후 통과했다. 기준/current fixture로 만든 HTML 전체 16,461바이트가 같고, 제거한 최상위 `samples` 이외의 모든 필드는 동일하다.
- 전체 변경의 Functions 검사 타입 `tsc -p tsconfig.test.json --noEmit` 통과.

통합 로그: `TEMP/household-remaining-six-sdk-20261005.log`, `TEMP/household-remaining-six-types-20261005.log`. 테스트·fixture 감소량을 제품 실행 코드 감소로 합치지 않는다. 제품 실행 코드는 A의 두 파일 137→131줄로 6줄 줄었다. 나머지 변화량은 각 담당 기록을 따른다.

## 전달 범위

제품 변경은 Functions의 명령 조립 한 곳이며 wire·저장 계약은 같다. 서버는 기존 release wrapper의 세 codebase 배포와 로그인·가구 Query smoke로 검증한다. Web·APK 실행 변경은 없다. 배포 결과는 release provenance, 전체 CI의 다섯 검사와 결과 요약은 최종 SHA의 Actions 실행에서 별도로 확인한다. 미완료 CI는 기존 후속 자동화에 전달하며 로컬 성공을 원격 성공으로 대신하지 않는다.

## CI 후속 — 이름 변경 동시성 검사의 실행 순서

`45b7e8346ac0aeb8e6e3798e08c1286e454015f4`의 [CI 37303017257](https://github.com/minkue777/household-account/actions/runs/37303017257)은 Functions 통합 검사 150개 통과·1개 실패로 종료했다. 다른 네 검사 job은 성공했고 요약은 실패다. 실패는 이번 여섯 파일과 별개의 HH-009/T-HH-004 이름 변경 동시성 검사이며, `FirebaseMemberRenameStore`의 두 번째 query(연결 명의 프로필 조회)에서 `3 INVALID_ARGUMENT: Transaction is invalid or closed.`가 발생했다. 기존 실패 이력을 성공으로 바꾸지 않는다.

에뮬레이터 로그는 11:31:20 UTC의 commit/query 잠금 시간 초과 뒤 11:31:22·27의 닫힌 transaction ID 조회를 기록했다. 설치된 Firestore 8.6.0·google-gax 5.0.7·retry-request 8.0.3 코드를 확인했다. 응답 metadata 전 오류는 요청 계층에서 코드와 무관하게 같은 요청으로 두 번 재시도할 수 있고, 상위 transaction runner는 이번 코드 3 메시지를 재시도하지 않는다. 이 경로의 지연은 CI 로그 간격과 일치하지만 최초 gRPC 코드·metadata 유무가 CI artifact에 없어 정확한 진입 경로는 미확정이다. 제품 저장 코드의 transaction 재사용 오류는 발견하지 못했다.

로컬에서 원본 파일 3개 검사는 통과했다(5.57초). 임시 진단에서 한쪽 프로필 조회를 100ms 늦춘 경우 1회, 0/1/2/5/10/50ms로 달리한 경우 6회도 통과했다. 따라서 제품 오류를 재현·수정했다고 표현하지 않는다. 이 진단의 실행 순서 제어와 SDK 로그는 임시 파일에만 보관했다.

후속 변경은 테스트의 경합 순서를 고정한다. 두 실제 transaction callback의 첫 실행이 동일 초기 상태에서 변경을 준비할 때까지 commit을 기다리게 한 뒤 동시에 해제한다. 실제 SDK의 read·commit·충돌 재시도는 그대로 사용하며, 두 첫 결과가 성공 후보였음과 적어도 한 번 callback이 재시도됐음을 새로 검증한다. 최종 성공 1건·이름 충돌 1건·저장 이름 1건·outbox 1건의 기존 기대값과 30초 제한은 유지한다. 이는 commit 간 충돌을 확실히 검증하는 검사이며, 임의의 query/commit 교차 순서나 운영 SDK의 모든 장애 복구를 검증하는 것으로 확대하지 않는다. 오류 시 SDK 요청·재시도 로그를 출력하고 두 요청이 모두 종료된 뒤 정리한다. 제품에 오류 재시도나 예외 분기를 추가하지 않았다.

수정 후 실제 Firestore 검사와 기존 이름 변경 정책·권한 검사 3파일 21개가 통과했다(6.29초, 실패·skip 0). 교차 검토 후 진입 전 실패도 상대 요청을 해제하고 최종 저장 assertion의 실패도 로그를 남기도록 정리했으며, 최종 실제 Firestore 3개를 다시 통과했다(5.27초). Functions test TypeScript 검사와 diff 검사도 통과했고 에뮬레이터는 정상 종료했다. 제품 `45b7e83`은 Firebase release `release-20261005-remaining-six-45b7e83`의 세 codebase·로그인 smoke 및 해당 SHA Web Git 배포가 이미 성공했다. 후속은 테스트·문서만 변경하여 Firebase·Web·APK 재배포가 필요하지 않다. 최신 SHA의 전체 CI는 별도로 추적한다.

진단 자료: `TEMP/household-remaining-six-ci-job-111740002124.log`, `TEMP/household-remaining-six-ci-artifacts-37303017257`, `TEMP/household-rename-ci-repro-20261005.log`, `TEMP/household-rename-controlled-repro-20261005.log`, `TEMP/household-rename-controlled-schedules-20261005.log`, `TEMP/household-rename-sdk-trace-20261005.log`, `TEMP/household-member-rename-ci-diagnostic-20261005.ts`.
