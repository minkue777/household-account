# Web 화면 계층 보강 조사

기준 SHA: `12a582bf63bae7ad5b7c66bcfbf67ac96fb338da`, 2026-10-05. 제품 코드·테스트·운영 데이터·배포를 변경하지 않은 정적 읽기 조사입니다.

## 실제 범위

`web/src/components`와 `web/src/app`의 TSX 74개를 모두 읽었다. hook/service와 테스트도 통합 검토했으며 파일별 범위는 [files.csv](files.csv), 테스트 후보는 [web-tests](web-tests.md)에 있다. 실행이나 Emulator 재현은 수행하지 않았다.

| 기능 계약 | 확인한 화면 경로·상태 소유 | 현재 판단 |
|---|---|---|
| HH-* 로그인/생성/가입 | HouseholdGuard → HouseholdLogin → HouseholdContext의 인증 동작 | 표시 폼과 인증 상태 소유가 나뉜 것은 타당. 로그인 폼과 제출 흐름 전체 읽음 |
| LED-005/006, SEA-* | LedgerPage → 날짜/수입요약/검색 → 편집 snapshot → command → projection | 수입 요약의 버전 전달 차이, 새 폼 초기화 소유 후보 |
| CARD-*, MER-*, REC-* | SettingsPage → 각 설정 폼 → service → command client | 저장 결과/실패 처리 계약이 일부 화면에서 누락 |
| CAT-* | Context + CategorySettings 별도 catalog 구독 → mutation gate | 기존 W8 판단 보강. version 추정/중복 default 소유 검토 유지 |
| AST-*/HOLD-* | AssetsPage snapshot → AssetHistoryModal → 두 holding manager/list | 실패를 빈 자료와 구분 못 하는 UI 경로 확인 |
| MARKET-*/HOLD-* | AssetAddModal의 검색/시세/임시 보유 → 계좌 생성 → 보유별 저장 | 기존 W5 보강: 선택 시세 응답의 세대 확인 없음 |
| STAT-*/STAT-AST-*/DIV-* | 통계 route가 bounded source/cache를 소유, 차트가 표시 범위·선택을 소유 | 기준 없음/0/실패 구분, 확정 배당과 미래 추정 분리를 유지. 차트 options·상세 표·선택 동작 전체 읽음 |
| ADM-* | AdminPage가 인증·request generation·조회/명령을 소유, 목록/현황이 표시 | 작은 표시 wrapper 유지. 대시보드 전체 JSX·관리 handler·표시 wrapper 전체 읽음 |
| PUSH-*/QE-*/PWA-* | AppProviders 수명 effects, 알림 연결 단계, Shortcut 일회 키, QuickEdit 기기 설정 | 서버 권한/Native·PWA 플랫폼 차이와 일회 비밀 표시를 단순화 명목으로 합치지 않음 |

## 중요한 추가 발견

### UI-01 · 실패·빈 목록·0원의 소유 계약을 읽기 경계에서 하나로 정합니다

- 계약: AST-001/002, HOLD-001~004. 기존 Web W1의 응답 결과 문제와는 구분합니다.
- 직접 읽은 근거: `useHouseholdHoldingSnapshots.ts:91~99`는 구독 setup 예외에서 기존/빈 snapshot의 두 ready를 true로 바꿉니다. 두 manager는 ready만으로 loading을 결정합니다(`useStockHoldingManager.ts:72`, `useCryptoHoldingManager.ts:57`). `AssetHistoryModal.tsx:74~79`는 loading이 끝나면 asset 잔액 대신 holding 합계를 선택하고, `StockHoldingList.tsx:549~552`/`CryptoHoldingList.tsx:116~119`는 빈 보유 문구를 표시합니다.
- 교차 근거: 실제 `assetService.ts`의 assets/stock/crypto listener 오류도 각각 1020/1717/1798 부근에서 projection에 빈 배열을 publish합니다. 관련 근거는 [Web W1](web.md)과 함께 본다.
- 의미: 최초 빈 snapshot이고 pending overlay도 없으면 조회 실패가 빈 보유·0원 평가로 나타날 수 있습니다. 기존 cache/overlay가 있으면 오래된 값이 남을 수 있으므로 모든 오류가 반드시 0이라는 주장은 하지 않습니다. 실제 장애 재현은 미실행입니다.
- 작은 설계: read 결과가 마지막 정상 값과 loading/error를 구분해 전달하고 화면은 그 상태만 사용합니다. catch마다 ready=true/[] 보완을 덧붙이지 않습니다. 실패 전 값이 없으면 평가액 미확정, 있으면 마지막 정상 값+실패로 표시합니다.
- 보존/검증: 실제 성공 []는 0/빈 목록이어야 합니다. 실패는 0으로 바뀌지 않아야 합니다. setup 중 첫 listener만 생성된 뒤 실패, 실제 listener error, cache 있음/없음, pending overlay, 세션 변경 후 늦은 callback을 실제 hook/UI 경계에서 검사합니다.
- 확신: 상태 전달 결손은 높음. 발생 빈도·운영 영향은 미측정입니다.

### UI-02 · 수입 요약 편집도 편집 시작 버전을 그대로 전달해야 합니다

- 계약: LED-005 expectedVersion, 수정·삭제 실패 복구.
- 근거: `IncomeSummaryModal.tsx:27~31,113,121`는 ID/updates만 넘깁니다. `useExpenseEditor.ts`는 선택 snapshot을 고정하지만 `LedgerPage.tsx:200~203,228~231`는 생략된 기대버전을 현재 구독 배열에서 찾습니다. 반면 날짜 상세는 `ExpenseDetail.tsx:126`에서 편집 대상의 aggregateVersion을 전달합니다. 실제 부모 연결은 LedgerPage:411~420입니다.
- 의미: v1 초안을 유지한 상태에서 구독 v2가 도착하면 수입 요약은 v2를 기대버전으로 사용할 수 있습니다. 같은 편집 기능의 진입 화면에 따라 버전 의미가 달라집니다. 실제 경합 재현·운영 덮어쓰기 발생은 주장하지 않습니다.
- 작은 설계: ID와 optional version을 여러 화면에서 다시 추정하는 대신 수입 요약도 편집 대상 snapshot/version을 콜백에 전달합니다. service의 원자성·멱등성·projection은 그대로 둡니다.
- 검증: v1에서 연 초안 → 외부 v2 구독 → 저장/삭제가 v1을 보내는지, 충돌 시 새 canonical 보존과 초안 복구, 일반 날짜/검색 편집과 같은 기대버전 의미를 검사합니다.
- 확신: 호출 인자 차이는 높음, 실제 경합 결과는 미검증입니다.

### UI-03 · 설정 저장의 성공·중복·실패 결과 처리를 화면 한 곳으로 모읍니다

- 계약: CARD-* 등록/삭제, MER-* 생성/수정/삭제, REC-001 계획 관리.
- 근거: `CardSettings.tsx:403~424,456~468`, `RecurringExpenseSettings.tsx:107~140`, `MerchantRuleSettings.tsx:94~128`는 일부 command rejection을 처리하지 않습니다. 실제 버튼이 그대로 async handler 또는 void 호출을 사용합니다(Card:721~724/874, Recurring:276/390~392, Merchant:291/393~395). 카드 상세 수정과 규칙 재정렬에는 별도 try/catch가 있어 같은 화면 안에서도 계약이 다릅니다.
- 서비스도 오류를 삼키지 않습니다. recurringCommands의 create/update/delete와 paymentConfigurationCommands의 해당 mutation은 command client를 await합니다. 특히 createMerchantRule은 중복을 빈 문자열로 반환하지만 MerchantRuleSettings는 반환 ID를 확인하지 않고 폼을 초기화합니다.
- 작은 설계: 기능별 저장 handler가 pending/result/error/초안 유지를 직접 소유하도록 맞춥니다. duplicate를 빈 문자열/boolean에 숨기는 결과는 소비자가 명확하게 처리하도록 좁힙니다. 세 설정을 큰 generic mutation framework로 묶지는 않습니다.
- 보존/검증: 중복 클릭은 새 command를 여러 개 만들지 않음, 중복 규칙은 성공처럼 폼을 지우지 않음, version conflict/권한/네트워크 실패가 화면에 전달됨, 실패 초안 유지, 성공 때만 초기화. 기존 card 상세/정렬의 오류 표시도 유지합니다.
- 확신: 오류/중복 결과의 소비 누락은 높음. 실사용 실패 건수는 미측정입니다.

### UI-04 · 폼의 초기화 단위를 외부 목록 참조가 아닌 편집 인스턴스로 맞춥니다

- 계약: LED-001/005, SPL-* 분할 입력, AST-001. 기존 W4 보강입니다.
- 근거: `AddExpenseModal.tsx:94~114`의 전체 폼 초기화 effect는 activeCategories를 의존합니다. `ExpenseSplitModal.tsx:38~46`는 expense 객체가 바뀌면 분할 초안을 다시 만듭니다. `AssetAddModal.tsx:200~222`는 ownerOptions가 바뀌면 이름·금액·임시 보유까지 지웁니다.
- 작은 설계: 열기/새 대상 선택을 명시적인 초안 생성 시점으로 정하고, catalog/명의 목록 갱신은 선택지 갱신·현재 선택의 유효성만 판단합니다. 불필요한 initializer+effect 중복은 이 경계를 정한 뒤 줄입니다.
- 보존/검증: 신규/다른 자산 선택은 정확한 초기값, 같은 세션 외부 목록 재조회는 입력 보존, 삭제된 category/owner는 조용히 다른 소유자로 저장하지 않음, 닫고 다시 열 때 정책 명시, pending 응답은 새 편집에 간섭하지 않음.
- 확신: effect 초기화 범위는 높음. 실제 사용 중 자료 갱신에 따른 입력 손실 재현은 미실행입니다.

### UI-05 · 신규 자산의 선택 종목과 시세를 같은 초안 세대에 속하게 합니다

- 계약: HOLD-*/MARKET-*; 기존 W5 보강입니다.
- 근거: `AssetAddModal.tsx:298~315,345~360`는 종목/코인을 선택한 뒤 quote await 응답을 무조건 currentPrice/currentPriceInfo에 적용합니다. 검색 요청에는 cancelled 가드가 있지만 선택 후 시세 요청에는 선택 ID/요청 세대 검사가 없습니다. 검색어를 바꾸면 이전 selected/price를 지우지만 이전 quote Promise는 계속 실행됩니다(:501~515,537~550).
- 의미: A→B 선택 뒤 A 응답이 늦게 오면 B 표시 초안에 A 가격을 쓸 수 있는 정적 경로입니다. 서버 canonical 저장까지 잘못됐다는 주장은 하지 않습니다.
- 작은 설계: 선택 ID와 quote 결과의 소유를 하나로 두고 해당 선택의 응답만 받습니다. 기존 계좌와 신규 계좌가 공유할 검색·선택 모델을 정리할 때 이 불변식을 중심으로 합칩니다. 새로 만든 계좌에 보유를 저장하는 별도 단계는 즉시 단일 transaction이라고 가정하지 않습니다.
- 검증: A/B 역순 응답, 선택 취소, 자산 유형 변경, 닫고 재개, quote 실패 뒤 수량/평단 보존, 펀드 priceScale/금 ETF/코인 소수 수량. 전부 UI 표시/실제 submit payload를 확인합니다.
- 확신: stale 응답 가드 부재는 높음, 실제 경합 재현은 미실행입니다.

## 유지가 더 단순한 코드

- `app/page.tsx`와 `app/income/page.tsx`의 한 줄 LedgerPage wrapper는 route와 거래유형을 정하는 실제 책임이 있습니다. 파일을 없애려고 route 처리를 컴포넌트 안으로 숨기지 않습니다.
- Portal의 SSR document 확인, ModalOverlay의 body/html 스크롤 복원, ConfirmDialog의 표시/선택, ColorPicker·CategorySelector·ExpenseTags·ManualHoldingForm 등은 작은 표시/입력 경계입니다. JSX 반복만으로 추상화 후보에 넣지 않습니다.
- FormattedIntegerInput의 caret 복원과 ExpenseTagInput의 IME 조합 중 Enter 방어는 입력 계약입니다. useRef가 있다는 이유로 제거하지 않습니다.
- deferredHomeContent의 공유 import, rejected lazy 교체, preload, 국소 오류 표시/재시도는 서로 다른 로딩 수명을 처리합니다. AppProviders의 인증/Native endpoint 갱신/원장 뒤 preload/계측은 실패가 업무를 막지 않아야 하는 독립 작업입니다.
- AdminPage의 세션 세대와 상세 요청 세대는 늦은 관리자 응답을 차단합니다. AdminHouseholdOperations의 작은 버튼·행 wrapper도 동작을 가리는 상태가 없으므로 유지합니다.
- NotificationSettings의 OS permission과 서버 endpoint active 상태는 같은 값이 아닙니다. ShortcutSettings의 metadata와 이번에 발급한 원문 secret도 합치면 안 됩니다.
- 새 자산 생성 뒤 보유별 Promise.allSettled와 부분 실패 안내는 실제 다단계 저장 결과를 드러냅니다. 이 경계를 무시한 일괄 실패/가짜 rollback으로 바꾸지 않습니다.

## 한계

화면·서비스·테스트 본문을 읽었으나 실제 터치·포커스·브라우저 재현은 하지 않았다. 위 후보 구현 시 정적 경로의 가능성을 실제 UI·Emulator 회귀로 먼저 재현한다.
