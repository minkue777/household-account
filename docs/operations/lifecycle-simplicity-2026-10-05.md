# 예약 작업·가구 생명주기 실행 경계 정비

## 계약과 변경

- A08/PT06: 예약 runner의 항상 통과하는 실패 주입 의존성을 제거했다. 페이지 조회 실패는 실제 page port 예외로 검사하며 실행 결과와 lease/fencing 처리는 그대로 유지한다.
- monitor의 테스트 전용 `recordRunRecovery`를 제거했다. 정상 완료는 execution repository의 `completeRun`이 소유하며 monitor는 이미 저장된 완료를 관찰한다.
- 가구 lifecycle application은 실제 호출되는 복구만 제공한다. 미사용 논리삭제·영구삭제 요청·접근 허용 API와 가상 purge 상태/ID 의존성을 제거했다. 실제 논리삭제는 관리자 console, 영구삭제는 checkpoint 기반 purge process가 계속 담당한다.
- 멤버 lifecycle의 미호출 `authorizeMember`, 명의 profile의 미호출 과거 단건 해석 API를 제거했다. 로그인은 실제 canonical resolver, 과거 명의 목록은 실제 `includeArchived` 목록 계약으로 검증한다.
- purge의 항상 proceed인 `beforeStep` 의존성을 제거했다. 저장 실패는 기존 운영 경로처럼 호출자에게 전달되며 checkpoint를 남긴다. 테스트용 retryable 결과를 새 제품 예외 처리로 옮기지 않았다.
- PT03 일부: 가구/멤버 fixture가 그대로 되돌려주던 업무 자료 지문·알림 endpoint 상수를 삭제했다. 실제 Firestore에 원장·자산·카드·endpoint를 넣고 관리자 제거/복구 전후 재조회한다. 프로필/rename의 나머지 상수는 별도 정비 대상이다.

## 검증 및 추적성

| 계약 | 실행 근거 |
|---|---|
| JOB-ERR-001/002 | 예약 실행·monitor·incident·lease·자산 page 단위 5파일 34개. 실제 Firebase summary 통합 3개: 완료→이전 장애 한 번 해제, 실패 이력 유지, 늦은 monitor 재개방 차단, 원자 rollback/경합 |
| ADM-003/T-ADM-002 | 복구 상태 전이, 권한·사유·scope·version·멱등성; 실제 관리자 삭제→복구 및 purge/claim page 통합 |
| HH-012/T-HH-007 | 멤버 제거·복구 후 실제 로그인 resolver의 first-visit/membership 전환, 같은 ID와 원장·자산·카드·endpoint 원문 보존 |
| HH-011/T-HH-006 | archived profile 기본 목록 제외 및 includeArchived 과거 조회 유지 |

관련 단위 4파일 40개와 Functions 타입 검사 통과. 실제 관리자/운영 통합 2파일 9개 통과 후, purge 실제 transaction 중단 두 경우를 추가한 운영 통합 7개도 통과했다. 테스트-only 복구 모형의 단위 사례 수를 그대로 유지하기 위해 운영에 없는 API를 남기지 않는다. 삭제·purge의 권한·보존·재개는 실제 경로로 이동했다.

운영 자료는 조회·변경하지 않았다. 로그: `TEMP/household-simplicity-job-recovery-20261005.log`, `TEMP/household-simplicity-lifecycle-20261005.log`, `TEMP/household-simplicity-purge-rollback-20261005.log`.
