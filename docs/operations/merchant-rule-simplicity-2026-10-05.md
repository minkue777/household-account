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

Functions 구현 변경이므로 clean commit에서 배포 계획·hash를 고정하고 기존 wrapper로 필요한 codebase를 배포합니다. Web·APK 변경은 없습니다. 공개된 v1.2.33 APK는 덮어쓰지 않습니다. 원격 CI와 배포·로그인 smoke는 별도 결과이며 진행 중이면 완료로 간주하지 않습니다. 운영 가계부 자료는 수정하지 않습니다.
