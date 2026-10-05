# 가맹점 규칙 저장 단순화

## 문제와 변경

실제 `FirebasePaymentConfigurationAtomicStore` transaction이 읽은 상태를 `merchantMutation`이 다시 복제해 가상 `read/transact` 저장소에 넣고, `createMerchantRuleCommandApplication`의 결과를 가변 `next/writes`로 회수하고 있었습니다. 이는 추가 원자성을 제공하지 않으면서 한 명령의 계산과 저장 책임을 중복 표현했습니다.

새 경로는 `runtime payload 해석 → create/update/delete/reorderMerchantRule(s)Mutation → 실제 AtomicStore 저장`입니다. 변경 계산은 현재 상태를 바꾸지 않고 `{state, value, writes}`를 반환합니다. `rememberExistingTransactionMutation`도 같은 생성 계산을 직접 사용하고 기존 exact 규칙이면 쓰기 없이 재사용합니다. 미사용 코드 삭제만이 아니라 실제 운영 요청이 거치는 실행 구조를 변경했습니다.

`merchantRuleCommandApplication`과 전용 동기 Store Port/Input Port, `merchantMutation`의 복제·가상 commit·결과 회수는 제거했습니다. 계약 테스트 fixture도 실제 변경 계산을 호출하고 테스트용 commit 성공/실패만 반영합니다. 가맹점 정책을 fixture에 복제하지 않습니다.

## 보존 계약과 추적성

| 계약 | 보존 사항 | 검증 |
|---|---|---|
| MER-003 | mapping 미제공 유지·명시 빈 값 제거, category 별칭 재발생 방지 | `payment-configuration-mapping.integration.test.ts` 4개 |
| MER-004 | 가구 권한, OR exact token·priority 유일성, 개별/collection version, 완전한 순서 목록, 충돌 시 무변경 | 기존 Command boundary 및 AtomicStore/와이어 검사, 새 실제 Firebase 경합·종류 변경·삭제 검사 |
| MER-004 재전송 | 같은 명령 결과 재생, 다른 payload 거부, 실패 commit의 상태 보존 | 실제 Firebase create/update replay, 기존 AtomicStore 및 Command 실패 검사 |
| MER-005 | 기존 exact 규칙 재사용, 지출 변경과 규칙 저장을 같은 실제 transaction으로 반영 | `remember-transaction-production.test.ts` |
| 수집 설정 최신성 | 실제 commit 때 Projection 무효화 | `payment-capture-projection-invalidation.test.ts` |

Firestore 저장 구조·외부 wire·인증·멱등 key는 바꾸지 않았습니다. 실제 저장 adapter가 계산 전후를 비교하고 receipt와 함께 쓰는 원자성 경계는 유지합니다. 카드 저장의 상태 회수와 카테고리 archive의 별도 메모리 모형은 이 변경에 포함하지 않았으며 후속 계약으로 남습니다.

## 검증 결과

- 관련 기존 5개 파일 54개 검사 통과. 검사를 삭제하거나 기대 결과를 약화하지 않았습니다.
- 실제 Firestore Emulator 2개 파일 7개 검사 통과, skip 0. 동시 exact OR 생성, 같은 version 동시 수정, receipt replay·payload 충돌, 순서 변경·match type 변경·claim 해제, mapping 정본 저장을 확인했습니다.
- Functions production build, 테스트 타입 검사, architecture 45개 통과.
- 이전 `faaf7d7` CI 37245317681의 functions/web-e2e 실패는 정비 분석 문서의 Windows 절대 경로 링크 62개였습니다. 상대 경로와 `#L` anchor로 수정하고 동일한 문서 링크 gate를 통과했습니다. 검사 기준은 바꾸지 않았습니다. 나머지 실제 Android 검사는 별도로 결과를 추적합니다.
- 로그: `TEMP/household-simplicity-merchant-{unit,integration,types,build}-20261005.log`.

## 배포

제품 SHA `0f3e23cdf1fa2a0277024b5f707d34d3a1fe5f4a`를 release `release-20261005-merchant-simplicity-0f3e23c`로 배포했습니다. 기존 wrapper의 clean commit·manifest/hash 검사와 `default`, `payment-capture`, `access-session` 세 codebase 배포, 실제 인증된 query/login smoke, provenance 기록이 모두 성공했습니다. Artifact SHA256은 `89acd3e93583bf5eb8d4567e6b261a6154625f5e79635f39ff39887c1ce502ff`입니다.

Web·APK 변경은 없습니다. 공개된 v1.2.33 APK는 덮어쓰지 않았고 운영 가계부 자료도 수정하지 않았습니다. 배포 로그는 `TEMP/household-simplicity-merchant-deploy-20261005.log`입니다.

## CI 후속 관측

- push CI [37246051987](https://github.com/minkue777/household-account/actions/runs/37246051987)의 새 가맹점 실제 저장 검사 3개와 mapping 검사 4개는 통과했습니다. 별개 지역화폐 검사 `firebase-local-currency-balance.integration.test.ts`의 최초 두 종류 동시 접수에서 `3 INVALID_ARGUMENT: Transaction is invalid or closed.`가 발생했습니다. 서버 통합 검사 결과는 110 passed / 1 failed이며 이 실패 이력을 성공으로 바꾸지 않습니다.
- 실패 지점은 `prepareFirstLocalCurrencySelection`의 legacy 잔액 조회입니다. 이 경로는 이미 순차 조회하고 있고 SDK는 해당 오류 문구를 재시도 대상으로 보지 않습니다. 조회·잠금 순서, SDK 또는 Emulator 중 실제 원인은 아직 확정하지 못했습니다. 오류를 포괄적으로 재시도하거나 제품 로직을 추측으로 변경하지 않았습니다.
- 이전 Android Native Firebase 검증이 문서 gate 때문에 실행되지 못해, 새 제품 SHA에서 실제 Android 검사를 포함한 [37246241461](https://github.com/minkue777/household-account/actions/runs/37246241461)을 별도로 시작했습니다. 이 실행은 지역화폐 실패를 발견하기 전에 시작됐으며 서버 전체 검사는 통과했습니다. 실패만 지우기 위한 무변경 재실행이 아닙니다. 로컬 지역화폐 실제 Emulator 검사도 2 passed로 실패가 재현되지 않았습니다. 로그: `TEMP/household-simplicity-local-currency-repro-20261005.log`.
- 실패 CI에서 Emulator 서버 로그가 보존되지 않아 먼저 트랜잭션이 닫힌 원인을 확인할 수 없었습니다. 후속 CI 변경은 Firebase 통합 검사 JSON 결과와 실패 시 Emulator 로그 artifact 보존만 추가합니다. 검사 입력·동시성·제한 시간·기대 결과·SDK 재시도 정책은 그대로이며 재발 시 원인 분석 자료로 사용합니다. 테스트 실행 설정·CI·문서만 바뀌므로 제품 재배포는 필요하지 않습니다.
- 최종 전체 CI와 앞선 실제 Android 검사가 끝나기 전에는 검증 완료로 간주하지 않습니다.

### WebKit 성능 시나리오의 지출 추가 로드 실패

같은 push 실행 `37246051987`의 Web E2E 본 검사는 통과했지만, 이후 성능 시나리오가 WebKit 준비 실행(iteration 0)에서 실패했습니다. 자산·통계 화면을 거쳐 홈으로 돌아온 뒤 지출 추가 버튼을 누르면 `내역 추가 화면을 불러오는 중입니다.`에 머물러 입력창의 30초 대기 제한을 초과했습니다. Chromium 시나리오는 통과했습니다. 뒤따른 235건의 표본 누락은 이 중단의 결과이며 성능 기준 초과가 원인은 아닙니다.

실패 JSON에는 `InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.`가 있지만 오류의 발생 위치·시각과 스크립트 다운로드 상태가 없으므로 지연 모듈 로드와의 인과관계는 미확정입니다. 제품 오류가 해결됐다고 간주하지 않습니다. 기존 실패 화면·HTML을 유지하면서 오류 stack/시각, 정적 JS·CSS 요청의 HTTP 상태·완료/실패, 현재 문서 script·stylesheet 로드 여부와 Service Worker controller를 실패 artifact에 추가합니다. 요청을 가로채거나 HTTP 캐시를 끄지 않으며, 검사 동작·30초 기준·기대 결과와 CI 표본 수를 유지합니다.

원본 자료는 `TEMP/household-simplicity-performance-ci-37246051987`, `TEMP/household-simplicity-web-ci-37246051987`, 실패 로그는 `TEMP/household-simplicity-ci-failed-37246051987.log`입니다. 후속은 검사 관측·문서 변경으로 Web/Firebase/APK 제품 배포가 필요하지 않습니다.

관측 보강 후 로컬 production build + 실제 Emulator + WebKit에서 준비 실행 1회와 진단 표본 1회의 전체 시나리오를 실행해 1 passed(1.8분), 33개 지표 66개 관측을 확인했습니다. 지출 추가·삭제와 기존 화면/저장 assertions를 통과했지만 간헐 실패가 재현되지 않아 원인 해결의 증거는 아닙니다. 로컬 진단 표본 수를 CI의 7회 성능 기준선과 혼동하지 않습니다. `tsc --noEmit`과 문서 링크 gate도 통과했습니다. 로그: `TEMP/household-simplicity-webkit-{prepare,diagnostics}-20261005.log`.

2026-10-05 09:26 KST 확인에서 제품 SHA의 별도 실행 `37246241461`은 다섯 검사·CI 요약이 모두 success이며 실제 Android Emulator/Native Firebase E2E/성능 step도 실행 후 성공했습니다. `f33fefa`의 `37246929110`은 functions/web/android 성공, web-e2e/android-instrumentation 진행 중입니다. 앞선 실패는 유지하고 관측 보강 후 최신 SHA의 전체 CI를 후속 확인합니다.
