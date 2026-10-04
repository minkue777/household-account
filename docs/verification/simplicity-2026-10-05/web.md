# Web 기능·계약 검토

기준 SHA: `12a582bf63bae7ad5b7c66bcfbf67ac96fb338da`. 제품 수정·테스트 실행 없이 소스와 호출 관계를 검토했다. `web/src` 제품 TypeScript 223개의 정적·동적 import/export를 TypeScript AST로 스캔했다. 타입 import도 포함한 보수적인 그래프이며, 도달 가능하다는 사실이 실제 기능 검토 완료를 뜻하지 않는다. 이후 전체 제품 본문과 테스트를 추가 검토했다. UI 세부 후보는 [web-ui](web-ui.md), 테스트는 [web-tests](web-tests.md), 최종 파일 범위는 [files.csv](files.csv)에 있다.

## W1. 자산 저장 결과를 클라이언트가 다시 구성한다 — 우선 정비

- 계약: AST-* / HOLD-*의 저장, 동시 수정 충돌, 즉시 화면 반영과 실패 복구.
- 경로: 자산/종목 폼 → `assetService` → `portfolioCommands` → 서버 transaction → snapshot.
- 근거: `web/src/lib/assetService.ts:65`부터 자산·주식·코인별 queue와 authoritative state를 각각 유지한다. `updateAsset:615`, `updateStockHolding:1177`, `updateCryptoHolding:1305`는 저장 응답 뒤에도 `commandExpectedVersion + 1`, 클라이언트 `new Date()`로 확정 결과를 구성한다. `web/src/features/portfolio/application/portfolioCommands.ts:66`의 변경 명령은 결과를 반환하지 않는다.
- 그 결과: 서버 원본, command floor, startup 원본, optimistic projection에 같은 개체의 상태가 나뉜다. 20초 waiter·버전 충돌 재조회·재시도가 이 사이를 연결하고 주식/코인에 유사한 흐름이 반복된다. 파일 길이가 아니라 **서버가 이미 아는 결과를 클라이언트가 추정하는 계약**이 정비 대상이다.
- 작은 설계: 서버가 같은 transaction에서 만든 자산·position의 확정 업무 필드/버전을 반환하고 receipt 재전송에도 같은 값을 제공한다. Web은 서버 원본과 사용자 변경을 명확히 구분한다. 명령 성공 후에도 관련 구독이 따라오기 전의 확정 overlay·삭제 표시는 필요할 수 있으며, 최초 권위 조회/rebase 대기 역시 응답 확장만으로 제거하지 않는다. 먼저 결과 추정을 없애고, 실제로 불필요해진 floor/waiter/분기만 삭제한다. 새 범용 mutation framework를 만들지 않는다. 실제 문서의 `serverTimestamp()`와 명령의 업무시각은 구별해야 하며, 계산 객체를 그대로 반환하면 저장 timestamp까지 같아진다고 가정하지 않는다.
- 유지: 연속 저장 순서, 사용자가 바꾼 필드만 전송, 시세 갱신과 사용자 수정의 충돌 구분, 부모 자산 버전 검증, 다른 세션의 늦은 응답 무효화. 최신 snapshot을 과거 command 결과가 덮지 않도록 버전 비교는 필요하다.
- 검증: `portfolioAssetServiceOptimistic`, `portfolioAssetStartupSync`, `portfolioOptimisticProjection`, 자산/종목 실제 저장 E2E와 서버 receipt 재전송. 서버 응답을 확장할 때 구 APK/Web 호환을 유지한다.
- 확신: 클라이언트의 확정 결과 추정과 상태 중복 구조는 확인. 상태층 제거 범위는 새 응답 계약을 구현하며 검증해야 한다. 서버 측 근거는 [finance](finance.md)를 함께 본다.

## W2. snapshot의 의미 대신 횟수로 확정을 추정한다 — 상세 설계 필요

- 계약: LED-001/005, QuickEdit와 Web 수정의 같은 즉시 반영, 날짜 이동·삭제 후 오래된 값 재등장 방지.
- 근거: `platform/read-model/optimisticEntityProjection.ts:204` 이후 reconcile은 observer ID, 시작 시 revision, 관찰 집합, original/canonical을 조합한다. 새 구독의 삭제 확정에 `revision > 1`을 요구하며 주석은 첫 cache·두 번째 서버 응답을 가정한다. API `publish(entities)`에는 cache/server 출처가 없다. 월/범위 원장 구독은 최초 cache를 걸러내지만, 연간 구독은 cache 여부를 계측하고 그대로 publish한다. 호출자별 의미가 다르다.
- 작은 설계: 실제 호출자별 publish 의미를 먼저 고정한다. 원본이 서버 확인됐는지와 조회 범위를 명시하면 횟수 기반 추정을 제거할 수 있는지 검증한다. 조회 이동과 서버 삭제가 모두 ‘목록에서 사라짐’으로 표현되는 문제부터 해결한다.
- 유지: 날짜 이동, 검색/월 목록 동시 구독, 새 구독의 오래된 cache, 최신 서버 삭제, Native expectedVersion, queued update/delete, session reset. 단순한 `map + pending`으로 곧바로 대체할 수 있다고 단정하지 않는다.
- 검증: 기존 projection 계약 전체와 실제 서버 저장→구독 순서 교란 E2E. 이 항목은 W1 이후 진행한다.

## W3. Firestore 경계가 SDK overload 전체를 흉내 낸다 — 축소 가능

- 계약: AND-012와 세션 복구. 종료된 listener의 재연결 및 가구 격리.
- 근거: `platform/read-model/firestoreReadModel.ts:42`는 `unknown[]`의 함수/observer 위치를 런타임 판별하고 SDK 함수 타입으로 이중 cast한다. 현재 제품 호출은 query/document + callback 또는 options + callback 형태다. observer overload 지원을 위해 실제 필요 이상의 인자 해석이 들어가 있다.
- 작은 설계: 앱에서 쓰는 한 가지 명시적 구독 시그니처로 줄이고 필요한 query/document 타입만 표현한다. 호출부를 함께 바꿔 런타임 overload 해석과 cast를 없앤다.
- 별도 확인점: error callback에서 permission 오류가 아니면 `requestRemoteSessionRecovery()`를 호출한다. 이 함수는 Android 여부·30초 간격만 보고 오류 종류를 구분하지 않는다. 네트워크/조회 오류까지 인증 복구를 깨우는 정책은 `HouseholdContext`, `AppProviders`, callable 복구와 함께 한 계약으로 검토해야 한다.
- 유지: permission 변경 후 권위 Membership 확인, Native 인증 복구, 같은 command envelope 재전송, listener 오류를 화면에 전달. 모든 catch를 없애는 작업이 아니다.
- 검증: `firestoreReadModelRecovery`, `membershipResolutionRecovery`, `firebaseCallableRecovery`, Android 복귀/계정 전환 E2E. 네트워크 오류와 인증 만료를 분리한 회귀가 필요하다.

## W4. 폼의 생성·초기화·복구가 여러 곳에 있다 — 기능별로 정리

- 계약: LED-005의 초안 보존·실패 복구·다른 편집 간섭 금지, AST-*의 최초 명의/값 표시.
- 근거: `ExpenseEditModal.tsx:67` 초기값과 `:158` effect의 초기값 복사가 중복된다. 저장/삭제는 `isSubmitting`·ref·`isMutationPending`으로 진행 상태를 관리한다. 부모 `ExpenseDetail`/`SearchModal`은 이미 `editorKey`로 편집 인스턴스를 구별한다. `AssetEditModal.tsx:70` 이후에도 다수 initializer와 선택 자산 effect가 같은 값을 각각 설정한다.
- 작은 설계: 편집 세션의 생성 시점을 부모에서 고정하고 해당 세션의 초안을 한 번 만든다. 선택 대상과 서버 snapshot, 사용자 초안을 구분한다. 저장 단계는 실제로 필요한 상태만 가지며, 실패한 초안을 복구하기 위해 필드를 다시 초기화하지 않는다. 비동기 응답 무효화 근거인 세션/인스턴스 확인은 유지한다.
- 유지: 즉시 모달 숨김, 실패 시 동일 초안 복귀, 같은 거래를 다시 열었을 때 새 인스턴스, 시세 수신 중 입력 보존. ref가 있다는 이유로 제거하지 않는다.
- 검증: `expenseEditSavePipeline`, `ledgerEditDraftPersistence`, `expenseDetailModalOwnership`, 자산 최초 paint/수정 피드백 검사. 저장·삭제·분할은 각 계약의 실패 동작이 달라 무조건 공통 runner로 묶지 않는다.

## W5. 주식/코인 검색 입력 흐름이 추가·상세 화면에 중복된다 — 국소 정비

- 계약: MARKET-* / HOLD-*의 검색·선택·시세·수량 입력.
- 근거: `AssetAddModal.tsx:133` 이후 검색/선택/시세 상태와 effect가 `useStockHoldingManager.ts:48`, `useCryptoHoldingManager.ts:34`의 흐름과 겹친다. `StockSearchForm`/`CryptoSearchForm`은 상태를 소유하지 않고 많은 getter/setter를 전달받는다. `sanitizeDecimalInput`도 추가 폼·두 manager·두 holding 목록에 반복된다.
- 작은 설계: 주식과 코인의 검색/선택 초안은 각각 한 소유자에 둔다. 추가 화면의 ‘저장 전 대기 목록’과 기존 계좌의 ‘즉시 저장’은 분리하고, 검색과 숫자 입력처럼 같은 정책만 재사용한다. asset 종류를 제네릭 schema로 설명하는 폼 엔진은 만들지 않는다.
- 추가 경합 후보: `AssetAddModal`의 종목 선택과 두 manager의 `selectStock`/`selectCoin`은 시세를 기다린 뒤 현재 선택/편집 세션이 같은지 확인하지 않고 값을 설정한다. A→B 선택 뒤 A 응답이 늦으면 B 초안에 A 시세가 들어갈 수 있는 코드 경로다. 검색 목록에는 취소 가드가 있지만 선택 시세에는 없다. 분산된 흐름을 하나의 선택 수명으로 정리하고 이 순서 교란을 재현해야 하며, 실제 운영 발생을 이번 조사로 확인한 것은 아니다.
- 유지: 주식 전체 검색 결과·30개씩 표시, 코인 최대 10개, 늦은 검색 응답 폐기, 펀드 priceScale, 미국 주식/코인 소수 수량, 금 ETF 판별.
- 검증: 검색 결과 전체 접근 E2E, 선택을 바꾼 뒤 이전 시세 응답, 취소/재열기 초안, 신규/기존 계좌 저장.

## W6. 홈 설정 UI의 테스트와 운영 연결이 다르다 — 계약 정리 우선

- 계약: HOME-004는 홈 카드 구성 UI를 목표로 선언한다. HOME-001은 아직 변경 UI가 없다고 기록한다.
- 근거: 앱 엔트리에서 출발한 import 그래프에 `components/settings/HomePreferencesSettings.tsx`가 없다. 저장소 참조도 전용 단위 테스트에서만 발견된다. `settings/index.ts`와 설정 페이지에 연결되지 않는다. E2E는 UI 저장 대신 command를 직접 보내고 홈 표시를 확인한다.
- 판단: 이 컴포넌트의 테스트 성공을 사용자 설정 기능 완료로 볼 수 없다. 반대로 ‘미사용’만 보고 HOME-004를 충족하는 유일한 예정 UI를 기능 취소까지 포함해 삭제하지 않는다.
- 정비: 현재 제공할 계약을 명확히 한 뒤 실제 설정 화면에 연결해 그 화면을 검사하거나, 미제공 기능으로 남길 경우 실행되지 않는 UI/전용 테스트를 정리한다. 임시 두 번째 UI는 만들지 않는다.
- 별도 단순 삭제 후보: 제품 그래프에서 사용되지 않는 `components/assets/index.ts`, `components/common/index.ts`, `components/search/index.ts`. 공개 라이브러리가 아닌 내부 barrel이며 전체 소비자 검색 뒤 삭제 가능하다.

## W7. 통계 캐시에 화면 애니메이션과 부분 수정 정책이 섞여 있다 — 조건부 정비

- 계약: STAT-* / STAT-AST-*의 기간 재사용·최신성·메모/분류 변경 반영.
- 근거: `platform/reporting/expenseStatisticsCache.ts`는 기간 겹침·pending 세대·TTL뿐 아니라 `JSON.stringify` 동등성으로 차트 배열 참조를 유지하고, 메모/카테고리 변경에만 특수한 version 검증 후 부분 patch를 적용한다. 자산 통계는 별도 `assetStatisticsQueryCache.ts` 정책을 사용한다.
- 작은 설계: 먼저 차트의 재애니메이션 여부를 표시 계층에서 결정할 수 있는지 검토한다. 캐시는 actor/기간/최신성과 명령 후 무효화에 집중한다. 부분 반영을 없애도 기존 즉시 표시 계약을 만족하는지는 실제 호출 비용과 E2E로 판단한다.
- 유지: 다른 가구·계정 데이터 비노출, 늦은 중복 조회 폐기, 오류를 0원으로 표시하지 않기, 기간 선택 즉시성. 두 캐시를 하나의 범용 캐시 엔진으로 합치는 것을 목표로 삼지 않는다.

## W8. 같은 카테고리 문서를 목록과 버전으로 나눠 다시 구독한다 — 원본 단위 정비

- 계약: CAT-* / BUD-*의 같은 catalog 원본, 기본값·순서·삭제 및 연속 변경의 버전 검증.
- 근거: `categoryService.ts`의 `readCategoryCatalog`는 목록·catalogVersion·defaultCategoryId를 함께 만든다. `CategoryContext.tsx:87`은 목록만 소비하고 `CategorySettings.tsx:67`은 같은 문서를 버전/기본값 전용으로 다시 구독한다. 설정의 기본값도 두 callback/effect에서 설정된다. `CategorySettings.tsx:99`는 서버 응답의 확정 버전 대신 현재 버전과 삭제 단계 수를 조합해 다음 저장 가능 시점을 추정한다.
- 작은 설계: 이미 존재하는 catalog DTO를 Provider가 그대로 소유하고 목록·버전·기본값을 같은 snapshot에서 파생한다. 명령이 반환하는 완료 단계/버전을 사용해 화면에서 저장소 단계 수를 알 필요를 없앤다. 별도 구독 공유 framework나 두 번째 cache는 추가하지 않는다.
- 유지: archive의 단계별 원자성, 서버 확정 전 이전 버전으로 다음 명령을 보내지 않기, 기본 카테고리 삭제 금지, 실제 카테고리 목록과 정렬 버전의 일치.
- 검증: `categorySettingsMutationFeedback`, `categoryCompatibility`, `monthlyBudgetPolicy`, 실제 catalog 순서·archive E2E. 구독 횟수 감소만으로 올바른 것으로 판정하지 않는다.

## W9. 오래된 가맹점 API와 실패를 빈 성공으로 바꾸는 경계 — 삭제·교정 구분

- 계약: MER-*의 규칙 조회·등록·편집·순서. 현재 UI는 `addMerchantRuleV2`/`updateMerchantRuleV2`를 사용한다.
- 근거: `merchantRuleService.ts`의 이전 `addMerchantRule`, `updateMerchantRule`, `ruleExists`, `ruleExistsV2`, `getRules`는 제품 소스 검색에서 정의 외 소비자가 없다. `CategoryContext`의 `getCategoryByKey`, `categoryLabels`, `categoryColors`도 Context에 실어 보내지만 제품 소비자가 발견되지 않았다. 동적/테스트 소비자를 마지막으로 확인한 뒤 삭제할 후보이다.
- 별개 문제: `subscribeToRules`는 meta/query error를 모두 `callback([])`로 바꾼다. `MerchantRuleSettings`는 이 callback에서 loading을 끝내므로 실제 조회 실패와 ‘규칙이 없음’을 구분할 수 없다.
- 작은 설계: 사용하지 않는 내부 API와 호환 이름을 제거한다. 실제 구독은 성공 목록과 오류를 별도로 전달하고 화면이 실패를 표시한다. 재시도·fallback을 여러 층에 붙이는 방식으로 해결하지 않는다.
- 추가 미사용 후보: `lib/assets/memberOptions.ts`의 `getAssetMemberOptions`, `getAssetOwnerOptions`, `buildLegacyAssetOwnerMap`은 제품/테스트 검색에서 정의 외 소비자가 없다. 특히 과거 이름을 배열 순서로 치환하는 마지막 함수는 현행 stable owner profile과 별개다. 같은 파일의 화면용 상수 소비자는 있으므로 파일 전체를 삭제하지 않는다.
- 검증: 실제 등록·편집·순서 및 조회 실패 UI, 기존 canonical mapping과 collectionVersion 충돌. 실패 동작 교정은 단순 dead-code 삭제와 별도 변경으로 다룬다.

## W10. 더 이상 쓰지 않는 인자를 호출부까지 운반한다 — 작은 삭제 단위

- 계약: LED-008/009의 월 분할 원자성, HH-009의 본인 이름 변경.
- 근거: `lib/utils/monthlySplitActions.ts:29`의 `runSplitMonthsAction`은 `deleteExpense`를 필수 인자로 받은 뒤 `void _deleteExpense`로 버린다. 실제 분할은 서버 명령 `splitExpenseMonthly` 한 번이다. `ExpenseDetail`과 `SearchModal`은 이 의미 없는 dependency를 계속 전달한다. `householdService.ts:69`의 이름 변경도 `_memberId`를 받고 쓰지 않는다. 현행 명령은 인증된 본인만 변경한다.
- 작은 설계: 실제 계약의 인자만 남기고 두 호출부와 테스트를 함께 정리한다. 삭제 함수를 다시 사용하거나 멤버 ID를 서버 권한 판단에 재도입하지 않는다. 서로 다른 기능의 제거이므로 각 계약 변경에 나눠 포함한다.
- 같은 종류의 추가 후보: `expenseService.addExpense`의 `notifyOnCreate` option은 `void options`로 버려지며, 현행 알림은 별도 명시적 요청이다. `generateSplitGroupId`, `assetService`의 비공개 `buildDividendMonthlyDataFromEvents`와 `refreshAllPhysicalGoldValues`도 제품·테스트 검색에서 호출자가 없다. 실제 배당 조회 세 함수는 `assetDividendReadModel`이 사용하므로 함께 제거하지 않는다.
- 검증: 분할 전후 총액·원거래 수명·명령 한 번 실행, 본인 이름 변경·타인 변경 거부. 호출 시그니처를 줄이는 데 새 wrapper나 호환 인자는 필요하지 않다.

## W11. 명의 조회의 한 줄 위임 계층 — 기능 단위로 평탄화 가능

- 계약: HH-011 / AST-*의 명의 목록 구독·오류 전달·보관 명의와 과거 참조.
- 경로: 자산 페이지 → `assetOwnerProfileReadRuntime` singleton → `AssetOwnerProfileQueries.subscribe` → `FirestoreAssetOwnerProfileReadModel.subscribe`.
- 근거: `AssetOwnerProfileQueries`는 같은 인자를 한 줄 위임하는 것 외에 상태나 정책이 없고 runtime도 생성한 객체만 보관한다. 실제 목록 mapping·정렬·오류 전달은 최종 adapter에 있다. 페이지 테스트는 앞의 singleton getter를 mock하므로 중간 class 자체가 실제 저장 경계 검증을 제공하지 않는다.
- 작은 설계: 목록 조회는 명시적인 구독 함수 하나와 필요한 mapping 함수로 표현한다. 실제 Firestore adapter를 교체해야 하는 검사에는 해당 함수 경계만 주입하면 된다. 새 facade/interface로 이름만 바꾸는 정비는 하지 않는다.
- 유지·검증: 생성 순서, stable profileId, archive 상태와 선택 가능 여부, 가구 전환 후 이전 listener 정리, 오류를 빈 성공으로 바꾸지 않기. 목록 실시간 변경은 실제 adapter 계약으로 검증한다. 공통 public.ts 형식 검사와 충돌하면 형식 규칙도 A07 기준으로 함께 검토한다.

## 유지할 코드와 남은 검토

- `clientSessionScope.ts`의 작은 불변 scope, `operationDeadline.ts`의 timer 정리, `ThemeContext`의 저장소 실패 시 화면 선택 유지에는 실제 역할이 있다. 단지 wrapper/catch라는 이유로 제거하지 않는다.
- PWA의 버전 handshake·미저장 입력 보존, QuickEdit의 Native 세션 범위 검증·ack·중복 방지, 시장 카탈로그 checksum/IndexedDB 처리는 외부 경계 계약을 먼저 확인해야 한다.
- `LocalStockInstrumentCatalog`의 두 작은 저장 경계, 마지막 정상 snapshot 보존과 중복 refresh 합치기는 실제 오프라인·캐시 실패를 다룬다. `clientSessionResetRegistry`는 지연 로드된 기능만 초기화하여 첫 번들에 모든 기능을 끌어오지 않는다. 분리가 있다는 이유로 한 파일로 합칠 대상이 아니다.
- `fidSafeFirebaseFunctions`의 SDK 우회는 외부 결함과 제거 조건이 명시되어 있다. 최신 SDK에서 결함이 해결됐다는 확인과 실제 FID 회귀 없이 단순 삭제할 수 없다. 이번 소스 조사로 upstream 해결 여부를 확인한 것은 아니다.
- 단순 표시 컴포넌트, 모든 JSX/CSS, 모든 테스트 assertion을 줄 단위로 검토한 상태는 아니다. AST 스캔과 위 계약 경로 상세 검토를 구분한다. 상세 진행은 파일 목록 및 상위 검토표에서 관리한다.
