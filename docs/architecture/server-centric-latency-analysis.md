# 서버 중심 리팩토링 전후 지연 분석

- 분석일: 2026-07-23
- 상태: 최신 성능 최적화가 반영된 **로컬 작업 트리 기준**이며, 배포 후 실단말 수치는 아직 측정 전이다.
- 비교 기준
  - 리팩토링 전: `1ffdc70800d5d6b6fa7071b2e8bfda0b43a25692`
  - 서버 권위형 전환: `042c7c09a9cf8d7a1972c2d89976adb00c921c40`
  - 최적화 전 현재 구조: 서버 권위형 전환 이후 대규모 기능이 누적된 코드
  - 최적화 후: 이 문서 작성 시점의 작업 트리
- 분석 범위: 첫 화면, 검색, 모든 모달·상세 화면, 일반 원장·자산 수정, Android 결제 수집과 Quick Edit

## 1. 결론

이번 성능 문제는 Quick Edit 하나의 문제가 아니었습니다. 사용자가 확인한 다음 증상은 같은 계열의 회귀였습니다.

- 첫 화면이 리팩토링 전보다 2배 이상 늦게 보임
- 지출 상세·수정·검색 같은 일반 상호작용에 미묘한 대기 발생
- 주식계좌를 눌렀을 때 예전에는 즉시 열리던 창이 약 0.3초 뒤에 열림
- 종목 첫 검색과 자산 명의자 표시가 늦음
- Android 결제 알림부터 DB 반영과 Quick Edit 표시까지 수초가 걸림

핵심 원인은 Clean Architecture의 의존성 방향이 아니라, 다음 구현 세부사항이 사용자 hot path에 겹친 것이었습니다.

1. 초기 route bundle에 기능 구현과 Firebase 의존성이 과도하게 포함되었습니다.
2. bundle을 줄이려고 모달을 동적 import로 옮기면 preload 완료 전 첫 클릭에서 chunk 대기와 `화면 준비 중` 대체 UI가 노출될 수 있었습니다. 2026-07-24부터 자주 쓰는 원장·자산 모달은 각 route 번들에 정적으로 포함합니다.
3. 모달 자체도 `Portal`의 mounted effect를 한 번 더 기다렸습니다.
4. 검색 debounce, 화면 전환 애니메이션, focus timer처럼 100~300ms의 고정 지연이 여러 기능에 남아 있었습니다.
5. 주식계좌 모달을 열 때 listener 초기화, 전체 종목 배당 조회, 전체 시세 갱신이 함께 시작되었습니다.
6. 서버 Command와 Android 결제 수집은 멤버십과 멱등 영수증을 중복 확인하며 Firestore 왕복을 직렬로 수행했습니다.
7. Android Quick Edit FIFO도 서버 응답 뒤 queue 저장, 재조회, lease 저장을 차례로 기다렸습니다.

따라서 이번 최적화는 “Quick Edit만 빠르게”가 아니라 다음 원칙으로 전체 경로를 다시 정리했습니다.

> 첫 화면 route에는 해당 화면의 클릭 UI를 완성된 형태로 싣고, 후속 저장 명령은 첫 paint 뒤 미리 준비하며, 클릭 뒤에는 chunk·고정 timer·불필요한 effect·원격 초기화를 기다리지 않는다. 서버에서는 동일한 안전성을 두 계층이 중복 구현하지 않는다.

Domain, Use Case, Port, Adapter의 경계는 유지했습니다. 제거한 것은 독립성을 위한 골격이 아니라 중복 왕복, 우발적 bundle 결합, 표시를 늦추는 장식과 선행 작업입니다.

## 2. 비교 기준을 섞어 해석하면 안 되는 이유

성능 비교에는 세 가지 구조가 있습니다.

| 단계 | 구조 | 사용자 체감의 핵심 |
|---|---|---|
| 리팩토링 전 | 클라이언트 직접 Firestore 읽기·쓰기, Android 기기 파서 | 즉시성은 높았지만 업무 정책과 파서가 클라이언트에 분산됨 |
| 서버 권위형 최적화 전 | 서버 parser·Command·Membership·멱등 경계, UI 동적 chunk | 정책 SSOT는 좋아졌지만 원격·로딩 단계를 hot path에 과도하게 배치 |
| 최신 작업 트리 | 서버 권위 골격 + 읽기 snapshot + UI 선로딩 + 서버 fast path | 정책 SSOT를 유지하면서 표시와 단순 명령의 불필요한 단계를 제거 |

운영 로그는 아직 두 번째 단계의 배포본을 주로 나타냅니다. 세 번째 단계의 개선 효과는 배포 후 같은 조건으로 다시 측정해야 합니다.

## 3. 번들 크기 비교

동일한 Next.js production build 기준의 First Load JS 추정치는 다음과 같습니다. 이 값은 배포 CDN의 실제 전송량이나 단말 parse 시간을 그대로 뜻하지 않지만, 각 구조의 초기 JavaScript 결합 정도를 비교하는 데 유효합니다.

| 비교 시점 | `/` | `/assets` | 해석 |
|---|---:|---:|---|
| 리팩토링 전 기준 커밋 | 약 230kB | 약 305kB | 기능이 적고 직접 연결이 많았던 기준 |
| 서버 권위형 구조의 회귀 정점 | 약 315kB | 약 393kB | 인증·공통 barrel·기능 projection이 root까지 유입 |
| 이번 전체 상호작용 최적화 직전 | 약 292kB | 약 368kB | 1차 route 분리 후에도 root 결합이 큼 |
| 2026-07-24 즉시 모달 작업 트리 | 약 129kB | 약 316kB | 완성 모달을 route에 포함해 첫 클릭 chunk 대기를 제거하되 회귀 정점보다 작게 유지 |

`/`가 크게 줄어든 직접 원인은 다음과 같습니다.

- `Calendar → components/common barrel → Portal·CategorySelector·categoryService·Firebase`로 이어지던 우발적 import chain을 직접 import로 변경
- 최상위 Session Provider가 모든 optimistic projection을 정적 import하던 구조를, 실제 로드된 기능만 등록하는 reset registry로 변경
- 로그인 화면을 signed-out 전용 동적 chunk로 분리
- 외부 Pretendard CDN 요청을 제거하고 동일한 시각을 유지하는 자체 호스팅 dynamic subset으로 전환

`/assets`는 요약 도넛 하나 때문에 초기 경로에 포함되던 Chart.js를 브라우저 기본 원형 그라데이션으로 교체했습니다. 여러 점선 SVG 원을 겹치던 방식은 12시 경계에서 화살표 모양의 렌더링 결함을 만들 수 있어 사용하지 않습니다. 자산 추가·수정·계좌 내역 모달을 route에 정적으로 포함한 뒤에도 약 316kB이며, 사용 경로가 없던 별도 `AssetBalanceChart`는 제거했습니다. 이와 함께 다음 방식으로 계좌 클릭 비용도 줄였습니다.

- 홈 첫 paint 직후 `/assets` route를 prefetch
- 자산 추가·수정·계좌 내역 모달을 route 번들에 정적으로 포함
- 계좌 클릭 순간 listener·배당 N건·시세 전체 갱신을 시작하지 않음

즉 주식계좌 약 0.3초 지연은 **자산 route 축소, 클릭 시점의 chunk wait 제거, 초기 원격 작업 제거**를 함께 적용해 해결합니다.

## 4. 사용자 경로별 전후 비교

| 사용자 동작 | 리팩토링 전 | 최적화 전 서버 권위형 구조 | 최신 작업 트리 |
|---|---|---|---|
| 캐시 있는 첫 화면 | localStorage 가구 키와 Firestore cache로 표시 | 큰 root bundle 평가와 Membership·가구 확인이 첫 구독과 경쟁 | 작은 root bundle, 검증 snapshot 선표시, 첫 paint 후 상호작용 준비 |
| 캐시 없는 로그인 | 가구 키 확인 후 가구 read | Auth → Membership 해석 → Web의 별도 Household read → 화면 구독 | Membership 해석 응답에 최소 Household read model 포함, Web의 중복 read 제거 |
| 일반 모달 첫 클릭 | 컴포넌트가 이미 bundle에 있어 즉시 표시 | 클릭 후 동적 chunk 다운로드·평가, `Portal` effect 뒤 표시 | route에 완성 모달을 정적으로 포함하고 `Portal`은 같은 React commit에서 표시 |
| 검색 | 입력 즉시 로컬 조회 | 100ms focus timer + 300ms 고정 debounce | 즉시 focus, 입력 즉시 검색 계약 실행 |
| 지출 상세·수정 | 각 항목에서 즉시 모달 표시 | 각 행마다 숨은 수정·분할 모달 인스턴스, 동적 chunk와 장식 애니메이션 | 상세 목록이 수정 모달 1개와 분할 모달 1개만 소유, 장식 지연 제거 |
| 주식계좌 클릭 | 로컬 state와 이미 열린 listener로 즉시 표시 | 모달 chunk, 계좌별 listener, 전체 배당 조회, 전체 시세 갱신이 겹침 | 가구 단위 보유 snapshot 재사용, 선택 종목만 배당 조회, 시세 자동 갱신 제거 |
| 자산 전체 시세 | 화면 진입과 가까운 시점에 실행 | 첫 계좌 상호작용과 경쟁 | 저장값으로 먼저 표시하고 전체 갱신은 5초 뒤 background 실행 |
| 일반 원장·자산 저장 | Firestore SDK의 latency compensation | Callable과 서버 확정 뒤 listener 수렴에 의존했던 구간 존재 | optimistic projection을 유지하고 서버의 중복 receipt 경계를 축소 |
| Android 결제 수집 | 기기 파서 → Firestore 저장 → Quick Edit | Auth → Membership Firestore → 서버 parser → root receipt → Ledger receipt → queue 저장·재조회 → Quick Edit | 서버 parser 유지, Native token claim으로 Membership read 0회, 단일 승인 root receipt 제거, queue 한 번 저장 후 즉시 표시 |

## 5. 최신 작업 트리에 구현된 개선

### 5.1 첫 화면

1. Signed-in Membership 해석 결과에 가구 이름, 생성일, 가구원, 홈 요약 설정을 포함한 최소 Household read model을 함께 반환합니다.
2. Web은 해당 응답이 유효하면 별도 Household Firestore read를 생략합니다.
3. 마지막 검증 Session·Household·월 원장·카테고리 snapshot을 먼저 표시하는 기존 fast path는 유지합니다.
4. signed-out 로그인 UI와 실제 사용 기능의 projection을 root bundle에서 분리했습니다.
5. 원장·자산 route의 클릭 UI는 각 route 번들에 포함하고, 첫 원장 paint가 완료된 뒤에는 다음 route와 저장 명령 runtime을 준비합니다.
   - `/income`
   - `/assets`
   - `/settings`
   - `/stats`
   - 원장 저장·삭제·가맹점 규칙 등 mutation runtime
6. Pretendard는 외부 CDN을 기다리지 않는 자체 호스팅 dynamic subset으로 제공합니다. 시스템 글꼴로 바꿔 시각을 달라지게 하지는 않습니다.
7. 지역화폐는 잔여예산과 같은 첫 화면 체감을 위해 가구별 마지막 정상 잔액 한 건을 첫 렌더 전에 표시하고, 가구 하위 Canonical balance 구독값으로 교체합니다. 별도 스케줄·background projection은 없으며 Firestore 모듈은 동적으로 불러와 작은 root bundle을 유지합니다.

이 구조는 “빈 화면을 오래 보여준 뒤 모든 것을 준비”하는 방식이 아닙니다. **현재 화면을 먼저 그린 뒤 다음 클릭 비용을 미리 지불**하는 방식입니다.

### 5.2 모든 클릭·모달·검색

- `Portal`의 `mounted` state와 `useEffect`를 제거해 모달을 같은 React commit에서 표시합니다.
- 원장 상세의 0.25~0.3초 장식 애니메이션과 월 전환 애니메이션을 제거했습니다.
- 검색 입력의 300ms debounce와 100ms focus timer를 제거했습니다.
- 자주 쓰는 원장·자산 모달의 dynamic import와 `화면 준비 중` fallback을 제거해 첫 클릭에 완성된 UI를 표시합니다.
- 자산 수정 폼은 빈 예금 상태에서 effect로 교체하지 않고 선택 자산의 유형·세부 유형으로 첫 렌더 state를 생성합니다.
- 지출 목록의 각 행이 수정·분할 모달을 하나씩 만드는 구조를 없애고, 상세 영역당 각 모달 하나만 유지합니다.
- 세션 종료 때 모든 기능 구현을 root에서 import하지 않고, 실제 로드된 projection만 reset registry에 등록합니다.

사용자가 느낀 “묘하게 0.3초 늦는” 고정 지연과 첫 chunk wait를 전체 UI 범위에서 제거한 변경입니다.

### 5.3 자산과 주식계좌

- 주식·가상자산 보유내역은 자산별 모달이 각각 구독하지 않고, 자산 페이지가 가구 단위 listener 하나씩을 유지합니다.
- Android WebView는 마지막 검증 화면 snapshot을 먼저 표시하되 원격 구독 전에 영속 Web Auth 토큰을 강제 갱신합니다. refresh token이 무효면 Native 로그인 세션으로 자동 교환하고, 15분 이상 백그라운드에 있다가 복귀해도 다시 확인합니다. 이후 백그라운드 Membership 재검증의 일시 실패가 보유내역 listener·전일 변동·통계 이력 조회를 영구 중단시키지 않으며, 인증 복원 전에 시작하지 못한 조회는 복원 직후 다시 실행합니다.
- navigation HTML을 `StaleWhileRevalidate`로 장기 보존하면 낮의 Web 배포 뒤 이전 client와 새 서버 계약이 섞일 수 있으므로 network-only로 고정합니다. build hash가 붙은 JS·CSS 등 정적 asset만 캐시합니다.
- 같은 브라우저 세션에서 마지막 household snapshot을 즉시 재사용합니다.
- 계좌 모달은 이미 받은 보유 snapshot을 asset ID로 필터링할 뿐, 열릴 때 새 listener를 만들지 않습니다.
- 계좌를 열 때 모든 보유 종목의 배당 API를 호출하지 않습니다. 사용자가 실제로 선택한 종목만 조회합니다.
- 계좌를 열 때 전체 주식·가상자산 시세를 자동 갱신하지 않습니다. 사용자가 요청한 수동 갱신과 별도 background 갱신 경로를 사용합니다.
- 자산 화면의 일간 변동 계산은 첫 상호작용보다 뒤인 1초 후 idle로 옮겼습니다.
- 전체 시장 시세 갱신은 자산 표시 후 5초 뒤에 시작합니다.
- 로컬 종목 검색의 고정 150ms debounce를 제거했습니다. 원격 검색 보호가 필요한 가상자산 경로의 debounce는 유지합니다.

### 5.4 일반 서버 Command

서버 권위는 유지하면서 같은 의미의 멱등 경계가 두 번 실행되는 경우를 줄였습니다.

- 마이그레이션된 사용자는 Command마다 Membership과 Household 문서를 각각 읽지 않고 `principalMembershipClaims` 한 문서에서 actor와 가구 lifecycle을 확인합니다.
- claim이 아직 없는 기존 데이터만 canonical Membership 경로로 fallback합니다.
- 다음 단순 Ledger 명령은 Domain transaction이 receipt를 소유하므로 Router의 별도 claim·complete를 생략합니다.
  - 수동 거래 등록
  - 거래 수정
  - 카테고리 변경
  - 거래 삭제
- 다음 단순 Portfolio 명령도 Domain idempotency boundary를 사용합니다.
  - 자산 생성·수정·삭제
  - 포지션 생성·수정·삭제
- Ledger Domain receipt에는 command payload hash를 기록해 같은 키에 다른 payload가 들어오면 `IDEMPOTENCY_PAYLOAD_MISMATCH`를 반환합니다.
- 동시 replay가 먼저 완료한 결과를 안전하게 재사용합니다.

분할·합치기·취소·알림·순서 변경·시장 갱신 등 여러 aggregate나 외부 효과를 다루는 명령은 공통 receipt를 그대로 유지합니다.

### 5.5 Android 결제 알림과 Quick Edit

1. WebView 세션 발급 시 서버가 Membership을 확인한 뒤 두 토큰을 발급합니다.
   - WebView용 token
   - Android Native 결제 수집용 Membership claim token
2. 최신 APK는 Native Firebase Auth도 두 번째 token으로 교체합니다.
3. 이후 정상 Android 결제 요청은 검증된 ID token의 `householdId`와 `memberId`를 사용하므로 Membership 확인을 위한 Firestore read가 0회입니다.
4. token claim이 없는 기존 APK는 `principalMembershipClaims` 한 문서, 더 오래된 데이터는 canonical 경로로 fallback합니다.
5. balance branch가 없는 일반 Android 승인 1건은 Ledger transaction 자체가 거래·중복·outbox·receipt를 원자적으로 기록하므로, 같은 의미의 outer root receipt claim·complete를 생략합니다.
6. 취소, 잔액 동시 처리, Shortcut 같은 복합 흐름은 root receipt를 유지합니다.
7. 그 밖의 root receipt도 새 claim은 atomic create, 완료는 직접 update로 축약했습니다.
8. payment-capture codebase는 실제 `FUNCTION_TARGET`에 해당하는 bootstrap만 로드해 Android 수집이 Shortcut 초기화 graph를 함께 평가하지 않게 했습니다.
9. Android Quick Edit FIFO는 enqueue와 idle head lease를 한 번의 암호화 저장으로 합칩니다.
10. 서버 응답에 포함된 snapshot을 queue에서 다시 읽지 않고 즉시 Activity에 전달합니다.

서버 parser는 그대로 유일한 권위입니다. 빠르게 보이기 위해 Kotlin parser를 다시 권위 경로에 넣거나, 서버가 거부할 수 있는 임시 지출을 먼저 확정 표시하지는 않았습니다.

## 6. 원격·영속 왕복 변화

정확한 Firestore RPC 수는 cache hit, legacy fallback, 명령 종류에 따라 달라집니다. 다음 표는 마이그레이션된 정상 경로에서 제거된 직렬 단계입니다.

| 경로 | 최적화 전 | 최신 작업 트리 |
|---|---|---|
| 로그인 직후 Household | Membership Function 응답 뒤 Web이 Household를 다시 read | Function이 이미 확인한 Household 최소 read model을 반환, Web의 중복 read 없음 |
| 일반 Command actor | Membership + Household 확인 | `principalMembershipClaims` 1문서 |
| 단순 Ledger·Portfolio | Router receipt claim → Domain transaction → Router receipt complete | Domain transaction의 receipt만 사용 |
| Android capture actor | capture마다 claim/Household 또는 canonical membership 확인 | 최신 Native claim 정상 경로는 Firestore 0회 |
| Android 단일 승인 receipt | root claim → Ledger atomic receipt → root complete | Ledger atomic receipt만 사용 |
| Quick Edit enqueue | queue 저장 → queue 재조회 → lease 저장 → 표시 | enqueue+lease 한 번 저장 → 응답 snapshot으로 바로 표시 |

이 변경은 대규모 트래픽을 위한 cache 계층을 추가한 것이 아닙니다. 현재 두 가구의 실제 요청에서 중복되는 원격·디스크 단계를 없앤 것입니다.

## 7. 속도 최우선이어도 유지한 핵심 안전장치

다음은 아키텍처 골격 또는 데이터 무결성에 직접 필요하므로 제거하지 않았습니다.

- Domain과 Firebase·React·Android 사이의 Port/Adapter 의존성 방향
- 서버 권위 TypeScript 결제 parser
- 거래의 payload fingerprint와 멱등 충돌 판정
- aggregate version 기반 동시 수정 충돌 처리
- 거래·receipt·필요한 outbox를 같은 Domain transaction에서 확정하는 원자성
- 분할·합치기·취소와 복합 branch의 공통 receipt
- Android 원문 및 Quick Edit의 Keystore 암호화
- 72시간 내구 FIFO와 재시도
- 마지막 성공 시세 fallback과 외부 공급자 장애 기록
- 사용자 결정에 따른 `minInstances=0`

반대로 다음은 필수 골격이 아니므로 hot path에서 제거하거나 뒤로 미뤘습니다.

- 모달 표시 전 장식 애니메이션
- 로컬 검색의 고정 debounce
- 클릭 순간의 전체 배당·전체 시세 갱신
- 각 목록 행·각 계좌가 소유하던 중복 모달과 listener
- Router와 Domain의 중복 receipt
- 매 결제마다 반복하던 Membership Firestore 조회
- Quick Edit 표시 전 queue 재조회

## 8. 최신 구조에 남는 한계

### 8.1 첫 설치·새 배포 직후

`/` bundle은 크게 줄었지만 Firebase Auth 복원, service worker, IndexedDB, 네트워크 연결 자체는 필요합니다. local snapshot이 전혀 없는 첫 로그인은 서버 Membership 확인을 생략할 수 없습니다.

### 8.2 `/assets` 직접 진입

자산 route의 First Load JS는 완성 모달을 포함해 약 316kB입니다. 리팩토링 전 기준 약 305kB보다 11kB 크지만 첫 클릭 chunk 대기를 없애기 위한 의도적 교환이며, 회귀 정점 약 393kB보다는 작습니다. 홈을 먼저 거치면 route prefetch 효과를 받지만 새 브라우저에서 `/assets`로 직접 진입하면 이 다운로드·parse 비용은 남습니다.

### 8.3 Android 첫 결제의 Function cold start

`minInstances=0`이고 서버 parser가 권위이므로 scale-to-zero 직후 첫 결제는 Cloud Function cold start를 겪을 수 있습니다. 다만 이번 변경으로 cold start 뒤에 이어지던 Membership read와 outer receipt를 제거했습니다. 실제 p95가 목표를 넘는지는 배포 후 다시 판단해야 합니다.

### 8.4 선로딩의 비용

자주 쓰는 모달을 route에 포함하므로 `/`는 약 12kB, `/assets`는 약 16kB 증가했습니다. 현재 가구 수와 “첫 클릭에 준비 화면을 보이지 않는다”는 요구를 반영한 의도적 선택이며, route prefetch는 유지하지만 별도 모달 preload 네트워크 경쟁은 제거했습니다.

### 8.5 서버 확정시간과 표시시간

optimistic projection으로 화면은 즉시 바뀌어도 서버 확정은 네트워크 상태에 따라 늦을 수 있습니다. 실패하면 rollback과 오류 표시가 동작해야 하므로, 단순히 모달을 빨리 닫는 것만으로 완료 판정하지 않습니다.

## 9. 최적화 전 운영 로그

아래 값은 최신 작업 트리의 결과가 아니라, 최적화 전 서버 권위형 배포본의 기준선입니다. CORS `204`는 제외했습니다.

### 최근 72시간 기준선

| Function | 표본 | p50 | p90 | p95 | 최대 |
|---|---:|---:|---:|---:|---:|
| `executeHouseholdCommand` | 701 | 499ms | 3,030ms | 4,287ms | 12,021ms |
| `executeHouseholdQuery` | 503 | 219ms | 2,237ms | 2,974ms | 10,728ms |
| `submitAndroidRawNotification` | 47 | 596ms | 1,770ms | 2,119ms | 4,249ms |

### known-warm 기준선

Cloud Functions v1 로그에 신뢰할 수 있는 cold-start 필드가 없어 같은 `instance_id`의 앞선 실행이 확인된 표본만 known-warm으로 분류했습니다.

| Function | 표본 | p50 | p90 | p95 | 최대 |
|---|---:|---:|---:|---:|---:|
| `executeHouseholdCommand` | 242 | 446ms | 3,033ms | 5,024ms | 9,060ms |
| `executeHouseholdQuery` | 404 | 181ms | 721ms | 1,699ms | 10,728ms |
| `submitAndroidRawNotification` | 26 | 282ms | 1,770ms | 1,844ms | 2,331ms |

known-warm에서도 수초 outlier가 있었으므로 기존 지연을 cold start 하나로 설명할 수는 없습니다. 이번에 줄인 Membership·receipt·UI chunk 단계가 각각 얼마나 기여했는지 revision별 계측으로 확인해야 합니다.

### 2026-07-23 23:15 이후 실단말 확인

사용자가 Android 첫 접속·Quick Edit, iPhone PWA 접속·Shortcut, 원장 수정을 수행한 시간대의 운영 로그를 같은 요청 correlation 기준으로 확인했습니다.

| 경로 | 관찰 시간 | 병목 |
|---|---:|---|
| 첫 접속 endpoint 등록 | 외부 2.328초, 내부 interactive 1.933초 | actor Membership 해석 1.504초 |
| 동일 세션 endpoint 재등록 | 164~274ms | warm 상태에서는 Membership·초기화 비용이 크게 감소 |
| 로그인 사용자 해석 | 첫 표본 576ms, 이후 47~76ms | 첫 Auth·Membership 준비 비용 |
| Android 결제 수집 | 외부 2.293초, 내부 1.846초 | capture Membership 1.398초, config 95ms, persistence 241ms, handler 446ms |
| iPhone Shortcut 결제 등록 | 3.693초 | 전체 요청은 확인됐지만 내부 stage 계측이 아직 없어 추가 분해 필요 |
| 원장 수정 | 146~551ms | 서버 확정 시간이며 optimistic 화면 반영과는 별도 |
| 원장 삭제 | 235~238ms | 서버 확정 시간 |
| 자산 시세 background 갱신 | 1.622~4.500초 | 외부 공급자 작업이며 모달 첫 표시를 막지 않아야 함 |

원격 로그에는 Android 알림 수신부터 `QuickEditActivity` 첫 frame까지의 기기 내부 구간이 남지 않습니다. 따라서 위 Android 수치는 서버 구간이며, 완전한 end-to-end 시간은 USB logcat 또는 향후 기기 telemetry가 있어야 분리할 수 있습니다. 이번 표본에서 다음 최우선 병목은 첫 접속과 Android 결제의 Membership fallback이고, iPhone Shortcut에는 stage 계측이 추가로 필요합니다.

## 10. 배포 및 호환 순서

Native Membership claim은 Functions와 APK가 함께 바뀌므로 다음 순서를 지켜야 합니다.

1. access-session Functions 배포
2. payment-capture 및 interactive command Functions 배포
3. Web 배포
4. 새 APK 배포·설치
5. 실제 단말 계측

기존 APK와 기존 데이터에는 fallback이 있어 즉시 중단되지는 않습니다. 다만 최신 APK는 `nativeCustomToken`을 요구하므로 access-session Functions가 먼저 배포되어야 합니다.

## 11. 배포 후 측정 항목

### 11.1 첫 화면

다음 조건을 분리해 측정합니다.

- Android WebView / iPhone PWA / 일반 브라우저
- 첫 설치 / 새 배포 직후 / 같은 세션 재진입
- local Session·Household·원장 snapshot hit / miss
- `navigationStart → app module 평가 → Household cache 복원 → 첫 원장 paint`
- root JS 다운로드·parse·hydration
- 첫 paint 뒤 preload가 첫 화면의 CPU·네트워크와 경쟁했는지

목표는 유효한 local snapshot이 있는 첫 원장 paint p95 500ms 이하입니다.

### 11.2 모든 상호작용

다음 동작마다 `pointer/click → modal first paint` 또는 `input → result paint`를 측정합니다.

- 지출 상세·수정·분할
- 검색 첫 입력
- 카테고리·지역화폐
- 자산 추가·수정·상세·차트
- 주식계좌·가상자산 계좌
- 종목 첫 검색
- 설정의 카드·규칙·정기지출

특히 주식계좌는 다음을 따로 기록합니다.

- 모달 클릭부터 완성 UI commit까지의 시간
- 계좌 클릭부터 overlay paint까지
- household holdings snapshot 준비 여부
- 배당·시세 요청이 modal paint 전에 시작했는지

안전한 로컬 상호작용의 목표는 click/input 후 결과 paint p95 100ms 이하입니다.

### 11.3 서버 Command

- command 종류
- actor claim 조회
- Router receipt 사용 여부
- Domain repository와 transaction
- outbox
- callable 전체 시간
- optimistic paint와 서버 확정 사이 시간
- rollback 발생률

단순 Ledger 서버 확정 목표는 warm p95 1초 이하입니다.

### 11.4 Android 결제와 Quick Edit

하나의 observation ID로 다음 시점을 연결합니다.

1. 알림 수신
2. 암호화 journal 완료
3. callable 시작
4. Native token claim Membership 해석
5. capture config 준비
6. Ledger transaction 완료
7. callable 응답
8. FIFO enqueue+lease 완료
9. Quick Edit Activity first frame
10. Web 원장 listener 반영

다음 표본을 분리합니다.

- Function cold / known-warm
- 새 APK Native claim / 기존 APK fallback
- 중복 승인 / 신규 승인
- 앱 foreground / background / 화면 잠금

알림 수신부터 Quick Edit first frame까지 p95 1초 이하를 우선 목표로 측정합니다. `minInstances` 증가는 이번 fast path의 실측 후에만 재검토합니다.

## 12. 완료 판정

다음 조건을 모두 확인해야 성능 회귀가 해결된 것으로 봅니다.

- 캐시가 있는 첫 화면 p95가 500ms 이하입니다.
- 지출뿐 아니라 주식계좌를 포함한 주요 첫 클릭 p95가 100ms 이하입니다.
- 첫 검색에 의도적인 100~300ms timer가 없습니다.
- 모달 표시 전에 전체 배당·전체 시세 갱신을 기다리지 않습니다.
- 단순 Ledger·Portfolio Command에 Router와 Domain receipt가 중복되지 않습니다.
- 최신 Android 결제 Membership 해석에서 Firestore read가 발생하지 않습니다.
- 일반 Android 승인에 root receipt와 Ledger receipt가 중복되지 않습니다.
- Quick Edit queue 내구성을 유지하면서 enqueue 뒤 재조회 없이 표시됩니다.
- 실패 시 optimistic rollback, 멱등 payload 충돌, FIFO 재시도가 정상 동작합니다.
- `minInstances=0` 상태에서 측정한 cold·warm 지표가 따로 존재합니다.

## 13. 주요 코드 근거

- 첫 화면과 route·명령 runtime preload: [`AppProviders.tsx`](../../web/src/components/AppProviders.tsx)
- 원장 mutation runtime preload: [`ledgerMutationRuntimePreload.ts`](../../web/src/composition/ledgerMutationRuntimePreload.ts)
- 첫 화면 Session·Household 적용: [`HouseholdContext.tsx`](../../web/src/contexts/HouseholdContext.tsx)
- Signed-in Household read model: [`firebaseSignedInUserResolver.ts`](../../functions/src/adapters/firebase/access/firebaseSignedInUserResolver.ts)
- 로드된 기능만 초기화하는 registry: [`clientSessionResetRegistry.ts`](../../web/src/composition/clientSessionResetRegistry.ts)
- 즉시 Portal: [`Portal.tsx`](../../web/src/components/common/Portal.tsx)
- 앱 내부 오류·확인·입력 대화상자: [`AppDialogContext.tsx`](../../web/src/contexts/AppDialogContext.tsx)
- 원장 모달 단일 소유: [`ExpenseDetail.tsx`](../../web/src/components/expense/ExpenseDetail.tsx)
- 즉시 검색: [`SearchModal.tsx`](../../web/src/components/search/SearchModal.tsx)
- 가구 단위 보유 snapshot: [`useHouseholdHoldingSnapshots.ts`](../../web/src/lib/utils/useHouseholdHoldingSnapshots.ts)
- 주식계좌 지연 작업 분리: [`StockHoldingList.tsx`](../../web/src/components/assets/StockHoldingList.tsx)
- Command actor·receipt fast path: [`householdCommandRouter.ts`](../../functions/src/bootstrap/commands/householdCommandRouter.ts)
- Command Membership claim: [`firebaseHouseholdCommandInfrastructure.ts`](../../functions/src/adapters/firebase/commands/firebaseHouseholdCommandInfrastructure.ts)
- Ledger atomic receipt: [`firebaseLedgerCommandRepository.ts`](../../functions/src/adapters/firebase/ledger/firebaseLedgerCommandRepository.ts)
- WebView·Native session token: [`firebaseWebViewSession.ts`](../../functions/src/bootstrap/firebaseWebViewSession.ts)
- Android token Membership 해석: [`firebaseCaptureMembershipResolver.ts`](../../functions/src/adapters/firebase/payment-capture/firebaseCaptureMembershipResolver.ts)
- Android 승인 branch fast path: [`captureBranchSubmissionApplication.ts`](../../functions/src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication.ts)
- capture target별 bootstrap: [`functions-payment-capture/index.js`](../../functions-payment-capture/index.js)
- Quick Edit enqueue·lease: [`QuickEditPendingQueue.kt`](../../android/app/src/main/java/com/household/account/quickedit/QuickEditPendingQueue.kt)
- Quick Edit 즉시 표시: [`QuickEditCoordinator.kt`](../../android/app/src/main/java/com/household/account/quickedit/QuickEditCoordinator.kt)
