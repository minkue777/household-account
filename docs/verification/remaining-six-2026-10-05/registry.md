# 명령·조회 레지스트리 단순화 검증

## 기준과 변경량

- 기준 SHA: `921ef881ccd84641aa711416cde7f31bfddbfabb`
- 검토일: 2026-10-05
- 실행 코드 집계 범위는 아래 두 파일 전체이며 빈 줄을 포함한 물리적 줄 수입니다. 범위를 옮기거나 새 helper로 코드를 이동하지 않았습니다.

| 파일 | 변경 전 | 변경 후 | 순감소 |
| --- | ---: | ---: | ---: |
| `functions/src/bootstrap/householdCommandRegistry.ts` | 58 | 52 | 6 |
| `functions/src/bootstrap/householdQueryRegistry.ts` | 79 | 79 | 0 |
| 합계 | 137 | 131 | 6 (4.38%) |

추가 실행 파일은 없습니다. 실행 코드 diff는 3줄 추가·9줄 삭제입니다. 테스트 변경·추가는 없으며, 이 검증 문서만 별도로 추가했습니다. 감소율은 이 두 파일에만 해당합니다.

## 변경한 계약: 공개 명령 핸들러 조립

`access.resolve-signed-in-user.v1` 하나를 임시 `Map`에 넣던 `accessReadHandlers`를 없애고, 기존 핸들러를 공개 registry의 입력 배열에 직접 넣었습니다. 단일 항목 Map → 배열 펼침 → 최종 Map으로 이어지던 중간 할당과 한 번만 쓰는 조립 래퍼가 없어졌습니다. 동일 파일에 있던 핸들러 구현을 그대로 유지하므로 다른 계층으로 책임을 옮기지 않았습니다.

보존한 계약은 다음과 같습니다.

- 입력: Firebase `db`로 전체 공개 command handler를 조립하며, resolver의 주체는 router가 검증한 `principalUid`입니다. 클라이언트 payload에서 actor를 받지 않습니다.
- 결과: 동일한 이름·등록 순서·handler metadata를 반환합니다. 공개 manifest의 누락·비공개·중복 등록 실패는 기존 manifest builder가 계속 검사합니다.
- 권한: resolver의 `access: "signed-in-user"`를 유지합니다. router는 이 명령에서 householdId 전달을 거부하며 active household membership을 선행 요구하지 않습니다.
- 실패: `SignedInUserResolutionError`만 같은 code의 `HouseholdCommandRejection`으로 변환합니다. 그 밖의 오류는 다시 던져 router의 재시도 가능한 `COMMAND_FAILED` 경로로 전달합니다.
- 저장: `idempotencyBoundary: "read-only"`를 유지하여 router receipt claim/complete를 생략합니다. resolver를 실제 호출하는 시점과 Firestore 읽기 경로는 변하지 않습니다.
- 조립 시점: resolver 실행은 계속 `execute` 내부입니다. 뒤따르는 다른 command factory 호출 순서와 생성 시점도 같습니다.

등록 배열의 문맥 타입으로 handler가 검사되므로 삭제한 `HouseholdCommandHandler` import를 대체하는 새 타입 단언은 필요하지 않습니다.

## 유지한 계약: 조회 레지스트리

전체 본문을 검토했으며 추가 단순화는 하지 않았습니다.

- `ledger.get-transaction.v1`은 object payload를 검사하는 router와 별개로 정확히 하나의 transactionId 필드, 허용 문자와 최대 길이를 검사합니다. 이 검사는 상위 경계와 중복이 아닙니다.
- `requireHouseholdReadScope`는 검증된 멤버의 householdId 또는 읽기 capability가 있는 관리자의 householdId만 사용합니다. repository는 해당 household의 transaction 문서를 읽고 저장된 householdId가 맞지 않는 자료를 반환하지 않습니다.
- repository의 `retryable-failure`는 기존 code·`retryable: true`로, 미조회는 `NOT_FOUND`·`retryable: false`로 구별합니다. 이 두 분기를 합치면 실패 계약이 달라집니다.
- 검색기는 첫 검색 요청에서만 Storage bucket/catalog를 생성하며, 이후 같은 인스턴스를 재사용합니다. `FirebasePortfolioInstrumentSearch`는 인스턴스에 crypto catalog cache를 보유하므로 매 요청 재생성은 캐시 보존을 깨뜨립니다. eager 생성은 검색과 무관한 query 조립 시점에도 bucket 설정을 요구하게 합니다.
- catalog의 publicationStore/readStore는 같은 저장 adapter이지만 입력 포트의 책임이 다릅니다. 최소 source 수와 runSource 연결을 보존합니다.
- query의 administrator 허용 여부와 외부 조회 quota metadata는 manifest registry 검사로 계속 확인합니다. shortcut credential status는 멤버 전용이며, instrument search/quote만 외부 quota를 사용합니다.

이를 줄이기 위해 범용 lazy helper, 공통 registry engine 또는 별도 설정 계층을 만들면 두 파일의 직접적인 조립 흐름보다 읽기 어려워지므로 도입하지 않았습니다.

## 확인한 참조 경로

두 대상 파일의 전체 본문과 다음 경로를 확인했습니다. 연관 파일은 아래에 적은 해당 기능 경계를 읽었으며, 연관 모듈 전체 정비를 주장하지 않습니다.

- 운영 caller: `functions/src/bootstrap/firebaseHouseholdCommand.ts`, `functions/src/bootstrap/firebaseHouseholdQuery.ts`의 전체 callable 조립·router 실행·wire 응답 경로
- 공개 계약: `contracts/fixtures/system/household-command-manifest.v1.json`, `household-query-manifest.v1.json`의 명령/조회 목록과 scope, `household-command.v1.json`, `household-query.v1.json`의 요청/응답 fixture
- 등록 검증: `functions/src/bootstrap/commands/householdCommandManifest.ts`, `functions/src/bootstrap/queries/householdQueryManifest.ts`
- 타입·인가·실패: `functions/src/bootstrap/commands/householdCommand.ts`, `householdCommandRouter.ts`, `functions/src/bootstrap/queries/householdQuery.ts`, `householdQueryRouter.ts`
- 로그인 주체 읽기: `functions/src/adapters/firebase/access/firebaseSignedInUserResolver.ts`의 전체 resolver, membership view/canonical membership/member profile 검증
- 거래 읽기: `functions/src/adapters/firebase/ledger/firebaseLedgerCommandRepository.ts`의 constructor·findTransaction 및 household 경계
- 검색: `functions/src/bootstrap/queries/portfolioMarketHouseholdQueryHandlers.ts`의 search gateway·payload·search handler, `functions/src/adapters/firebase/portfolio/firebasePortfolioInstrumentSearch.ts`의 전체 검색 및 cache 흐름
- 인접 조립: `functions/src/bootstrap/commands/accessHouseholdCommandHandlers.ts`의 create/join 등 등록 책임, `shortcutCredentialHouseholdCommandHandlers.ts`의 session·결과 변환 경계
- 실제 SDK 테스트 연결: `functions/test/integration/callable/firebase-callable-wire.integration.test.ts`의 명령으로 저장한 거래를 `ledger.get-transaction.v1`으로 읽는 경로를 확인했습니다. 이 작업에서는 실행하지 않았습니다.
- 기존 검토 기록: `docs/verification/simplicity-2026-10-05/server-boundaries.md`의 실제 command/query 조립·권한·receipt 유지 판단

## 실행한 검증과 한계

아래 명령은 `functions` 디렉터리에서 실행했습니다.

- `npm exec -- vitest run test/bootstrap/household-command-manifest-registry.test.ts test/bootstrap/household-query-manifest-registry.test.ts test/bootstrap/household-command-router.test.ts test/bootstrap/household-query-router.test.ts` — 종료 0, 4개 파일·26개 테스트 통과
- `npm exec -- tsc -p tsconfig.json --noEmit` — 종료 0
- 저장소 루트에서 두 대상 파일에 대한 `git diff --check` — 종료 0

manifest 검사는 실제 Firebase registry factory를 생성하여 공개 명령/조회 목록과 metadata를 확인했습니다. router 검사는 주체·가구·위조 identity·receipt·오류 전달을 기존 fixture로 확인합니다. 삭제한 내부 wrapper를 흉내 내는 테스트는 추가하지 않았습니다.

에뮬레이터 시작/종료, callable·Firestore 실제 SDK 통합 검사, 운영 서비스 호출, 성능 벤치마크, commit·push·배포는 이 작업에서 수행하지 않았습니다. 중간 Map 한 개의 제거는 코드 구조로 확인한 사실이며 체감 성능 개선으로 주장하지 않습니다.
