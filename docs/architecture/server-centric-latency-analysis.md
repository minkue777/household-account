# 서버 중심 리팩토링 전후 지연 분석

- 분석일: 2026-07-23
- 비교 기준
  - 리팩토링 전: `1ffdc70800d5d6b6fa7071b2e8bfda0b43a25692`
  - 서버 권위형 전환: `042c7c09a9cf8d7a1972c2d89976adb00c921c40`
  - 현재 코드: 이 문서 작성 시점의 작업 트리
- 분석 범위: 첫 화면, 일반 지출 수정, 자산 조회·수정, Android 결제 수집과 Quick Edit

## 1. 결론

현재 지연의 핵심 원인은 **Clean Architecture 자체가 아니라, 서버 권위 경계를 구현하면서 사용자 상호작용의 hot path에 원격 단계와 직렬 Firestore 작업을 과도하게 넣은 것**입니다.

사용자가 확인한 현재 체감 기준으로 원인 우선순위는 다음과 같습니다.

1. **첫 접속**은 기존의 가구 키 확인보다 Firebase Auth, App Check, Membership 해석, 가구 read model 확인 단계가 늘었습니다. 캐시가 없는 첫 실행에서 이 차이가 가장 크게 드러납니다.
2. **Android 결제 알림**은 예전의 기기 내 파싱·직접 저장에서, 서버 인증·파싱·설정 조회·멱등 처리·저장 완료 후 Quick Edit을 여는 경로로 바뀌었습니다. 따라서 Quick Edit 표시가 서버 전체 처리시간에 종속됩니다.
3. **자산·종목 검색의 첫 실행**은 자산 snapshot 부재, 별도 명의자 listener, 종목 catalog 다운로드·검증·압축 해제·색인 준비가 겹칩니다.
4. `minInstances=0` 상태에서 큰 Functions 모듈 graph를 처음 로드하는 비용과 CORS·첫 Auth/App Check 토큰 비용이 위 경로에 더해집니다.
5. 일반 Command에는 멤버십 확인, 공통 멱등 영수증, 업무별 멱등 영수증, 업무 데이터 읽기·쓰기, 공통 영수증 완료가 직렬로 이어지는 구조적 비효율이 있습니다. 다만 현재 단순 수정 UI는 optimistic 반영이 복원되어 있고 사용자가 수정 지연을 큰 체감 문제로 보지 않으므로, 이는 즉시 체감 병목이 아니라 서버 확정시간과 향후 유지보수·tail latency 문제로 분류합니다.
6. 자산 Command는 한 자산을 수정할 때도 가구의 전체 자산·전체 포지션·명의자·자동화 계획과 legacy 자료를 트랜잭션 안에서 읽습니다. 현재 체감보다 자산 수 증가 시 악화될 구조적 부채에 가깝습니다.

따라서 `minInstances`를 늘리는 것보다 먼저 **첫 화면의 인증·Membership gate를 줄이고, Android 결제 fast path를 축약하며, 첫 실행의 JS·catalog·background prewarm 경쟁을 제거**해야 합니다. Command 내부 단순화와 canonical/legacy 종료는 그다음 구조 개선으로 진행합니다.

## 2. 전후 실행 경로 비교

| 사용자 동작 | 리팩토링 전 | 현재 | 늘어난 비용 |
|---|---|---|---|
| 캐시 없는 첫 접속 | localStorage 가구 키 → Firestore 키 확인 → 가구 문서 읽기 | Firebase Auth 복원 또는 Android custom token 교환 → App Check 준비 → Membership 해석 Function → canonical Membership·Member·Household 확인 → 가구 read model 읽기 → rules Membership 검사 → 각 화면 구독 | 인증·Membership 원격 단계, Function cold/warm 편차, rules lookup, 추가 JS 초기화 |
| 지출 수정·삭제 | Web Firestore SDK가 문서를 직접 변경하고 같은 SDK의 listener가 pending write를 즉시 표시 | HTTPS callable → 서버 멤버십 확인 → 공통 영수증 → Ledger 영수증·거래 읽기 → canonical/legacy/outbox 쓰기 → 공통 영수증 완료 → listener 수렴 | 추가 네트워크 왕복, 다수의 직렬 트랜잭션, latency compensation 상실 |
| 자산 수정 | 클라이언트에서 필요한 문서를 직접 변경 | HTTPS callable → 멤버십·공통 영수증 → 가구 전체 Portfolio 상태 로드 → 정책 계산 → canonical/legacy 쓰기 → 영수증 완료 | 한 자산 수정이 가구 전체 상태 크기에 비례 |
| Android 결제 수집 | Kotlin 파서 → 규칙·카드·중복 확인 → Firestore 직접 저장 → Quick Edit | 암호화 journal → Auth/App Check callable → 서버 Membership → TypeScript 파서 → capture receipt → 결제 설정 조회 → Ledger transaction → receipt 완료 → snapshot 암호화 저장 → Quick Edit | Quick Edit 전 서버 전체 경로 대기, Function 및 추가 트랜잭션 |
| Quick Edit 저장 | Firestore 직접 수정 | 암호화 outbox 동기 저장 → WorkManager 영속 예약 대기 → Activity 종료, 서버 전달은 비동기 | 서버 응답은 기다리지 않지만 로컬 암호화·동기 fsync·WorkManager 예약을 기다림 |

현재 일반 원장·카테고리·자산 **조회 자체는 모두 Function을 거치는 구조가 아닙니다**. 이들은 대부분 rules로 보호된 Firestore `onSnapshot`을 직접 사용합니다. Function 병목은 주로 쓰기 Command, 인증·Membership 해석, 외부 시세 Query, Android raw 결제 수집에 있습니다.

## 3. 운영 로그 근거

2026-07-23 20:17 KST 기준 Cloud Functions v1의 `Function execution took ... status code 200` 로그를 집계했습니다. CORS `204`는 실행시간 통계에서 제외했습니다.

### 최근 72시간

| Function | 표본 | p50 | p90 | p95 | 최대 |
|---|---:|---:|---:|---:|---:|
| `executeHouseholdCommand` | 701 | 499ms | 3,030ms | 4,287ms | 12,021ms |
| `executeHouseholdQuery` | 503 | 219ms | 2,237ms | 2,974ms | 10,728ms |
| `submitAndroidRawNotification` | 47 | 596ms | 1,770ms | 2,119ms | 4,249ms |

### 최근 24시간

| Function | 표본 | p50 | p90 | p95 | 최대 |
|---|---:|---:|---:|---:|---:|
| `executeHouseholdCommand` | 185 | 599ms | 4,287ms | 6,026ms | 9,060ms |
| `executeHouseholdQuery` | 228 | 298ms | 2,992ms | 5,461ms | 10,728ms |
| `submitAndroidRawNotification` | 24 | 565ms | 2,119ms | 2,331ms | 4,249ms |

### 콜드 스타트 영향 분리

Cloud Functions v1 로그에는 신뢰할 수 있는 cold-start 필드가 없으므로, 같은 `instance_id`에서 앞선 실행이 확인된 호출을 known-warm 표본으로 분류했습니다.

| Function | known-warm 표본 | p50 | p90 | p95 | 최대 |
|---|---:|---:|---:|---:|---:|
| `executeHouseholdCommand` | 242 | 446ms | 3,033ms | 5,024ms | 9,060ms |
| `executeHouseholdQuery` | 404 | 181ms | 721ms | 1,699ms | 10,728ms |
| `submitAndroidRawNotification` | 26 | 282ms | 1,770ms | 1,844ms | 2,331ms |

같은 인스턴스에서 직전 실행 후 각각 12초, 58초, 5초 만에 Command 9.060초, Query 10.728초, Android raw 2.331초가 걸린 사례가 있었습니다. 이는 수초 지연을 콜드 스타트 하나로 설명할 수 없다는 직접적인 근거입니다.

반면 각 인스턴스에서 처음 관찰된 호출의 중앙값은 Command 1,825ms, Query 2,116ms, Android raw 650ms였습니다. known-warm 중앙값과의 관찰 차이는 각각 약 1.38초, 1.94초, 0.37초입니다. 다만 request 종류와 배포 revision이 섞여 있으므로 이를 순수한 cold-start 비용이나 상한으로 해석할 수는 없습니다. cold 영향의 정확한 크기는 revision과 command type을 나누고 명시적인 process boot marker를 추가한 뒤 다시 측정해야 합니다.

`minInstances=1` 시험 구간은 약 88분이었고 실제 표본이 Command 2건, Android raw 1건, Query 0건뿐이었습니다. 그중 느린 Command는 외부 금 시세 공급자 호출을 포함했습니다. 따라서 이 표본으로 상시 인스턴스의 효과를 확정할 수 없습니다. 현재 세 Function은 사용자 결정에 따라 모두 `minInstances=0`입니다.

최근 72시간 CORS `204`는 Command 321건, Query 346건이었습니다. 서버의 preflight 처리시간은 짧지만 단말에서는 별도의 네트워크 왕복이므로, 첫 호출이나 CORS cache miss에는 추가 비용이 됩니다.

### 측정 한계

- 위 수치는 Function 내부 실행시간입니다. 단말↔Function 네트워크, Auth/App Check 준비, callable 직렬화, 응답 후 화면 갱신시간은 포함하지 않습니다.
- Command·Query 종류가 섞여 있습니다. 특히 외부 공급자 호출이 Query와 일부 Command의 tail latency를 높입니다.
- 리팩토링 전 직접 Firestore 호출에는 동일한 서버 로그가 없어 과거의 정확한 end-to-end 백분위와 일대일 비교할 수 없습니다.
- 따라서 현재 데이터는 원인 후보를 충분히 좁히지만, 세부 단계별 기여도를 확정하려면 9장의 계측이 필요합니다.

## 4. 원인별 상세 분석

### 4.1 첫 화면: 정적 호스팅보다 인증·세션 부트스트랩

현재 `/`는 Vercel에서 정적으로 제공됩니다. 동일 lockfile로 비교한 production build에서 리팩토링 전 First Load JS는 `/` 약 230kB, `/assets` 약 305kB였고 현재는 각각 약 315kB, 393kB였습니다. 각각 약 37%, 29% 증가한 값으로 첫 설치·새 배포 후의 다운로드, JavaScript parse, hydration을 느리게 하는 보조 원인입니다. 분석 PC에서 배포 HTML의 TTFB를 5회 측정했을 때 첫 요청은 0.889초, 이후 요청은 0.273~0.302초였습니다. 단말 환경을 대표하는 수치는 아니지만, 현재 3초 이상의 첫 로딩을 Next.js 서버 렌더링 cold start 하나로 설명하기는 어렵습니다.

현재 `HouseholdProvider`에는 다음 최적화가 이미 있습니다.

- 마지막으로 검증된 Membership과 Household를 localStorage에서 동기 복원
- 월 원장과 카테고리 snapshot 선표시
- Firebase App Check 지연 초기화
- Command chunk, 자산 구독, 종목 catalog의 idle prewarm
- Android Web Auth persistence와 custom-token fallback

하지만 캐시가 없거나 버전이 맞지 않는 첫 실행은 환경별로 다음 경로를 거칩니다.

PWA·일반 Web:

1. Firebase Auth persistence 복원
2. App Check 초기화
3. `access.resolve-signed-in-user.v1` 실행
4. `users/{uid}/householdMembershipViews` query
5. canonical Membership, Member, Household 문서 병렬 확인
6. Web에서 Household read model 읽기
7. 원장·카테고리·자산 Firestore listener 시작

Android WebView:

1. native `createWebViewSessionToken` Callable 실행
2. 서버가 custom token 생성과 Signed-in Membership 해석을 병렬 수행
3. WebView가 `signInWithCustomToken` 수행
4. Function 응답에 포함된 prefetched Membership 결과를 사용
5. Web에서 Household read model 읽기
6. 원장·카테고리·자산 Firestore listener 시작

최신 Android 정상 경로는 prefetched Membership을 반환하므로 `access.resolve-signed-in-user.v1`을 다시 호출하지 않습니다. 다만 별도 Household read는 남습니다.

리팩토링 전에는 localStorage 가구 키와 멤버 ID를 읽고 가구 문서를 확인하는 경로였습니다. 새 구조가 인증과 tenant 격리를 더 정확하게 만들었지만, **캐시 없는 첫 화면에 원격 gate가 여러 개 생긴 것**이 지연의 직접 원인입니다.

유효한 paint cache와 같은 UID가 복원된 경우에도 현재 코드는 cached Membership 해석 결과를 서버 해석의 대체값으로 사용하지 않고 Membership Callable을 배경에서 다시 실행합니다. 화면 선표시는 유지되지만 첫 데이터 구독과 같은 시점의 네트워크·CPU 경쟁은 남습니다.

또한 로그인 직후 750ms, 1초, 1.5초에 Command module, 종목 catalog, 자산 listener를 prewarm합니다. 의도는 다음 화면을 빠르게 하는 것이지만, 느린 단말이나 첫 네트워크 연결에서는 홈 원장·카테고리 구독과 CPU·IndexedDB·네트워크를 경쟁할 수 있습니다. 생성된 service worker는 첫 설치·새 배포 때 다수의 앱 자산을 precache하므로 이 구간의 다운로드 경쟁도 함께 계측해야 합니다.

서버 권위형 전환 직후에는 PWA 시작 URL이 `NetworkOnly`였고 App Check 초기화가 첫 렌더의 선행 조건이었던 회귀도 있었지만, 현재는 `StaleWhileRevalidate` 시작 URL cache와 지연 App Check 초기화로 이미 수정되었습니다. 이를 현재의 미해결 원인으로 다시 계산해서는 안 됩니다.

### 4.2 지출 수정: 한 번의 변경에 이중 멱등 경계

일반 tenant Command의 공통 경로는 다음과 같습니다.

1. 계약·Auth 검사
2. Membership 문서와 Household 문서를 병렬 조회해 Actor 해석
3. 공통 `commandReceipts` claim 트랜잭션
4. 업무 handler 실행
5. 공통 `commandReceipts` complete 트랜잭션

Ledger update/delete handler 안에서는 다시 다음 작업이 일어납니다.

1. Ledger 업무 receipt 조회
2. canonical transaction과 legacy `expenses` 문서 조회
3. Ledger 트랜잭션에서 업무 receipt, canonical, legacy를 다시 확인
4. canonical transaction, legacy `expenses`, outbox event, Ledger receipt 쓰기
5. 공통 router로 돌아와 공통 receipt 완료

즉 단순 필드 수정도 대략 **Membership → 공통 claim → Ledger receipt → 거래 read → Ledger commit → 공통 complete**의 직렬 서버 단계를 거칩니다. 멱등성과 migration 안정성은 높지만, 두 receipt 계층과 canonical/legacy 이중 쓰기가 hot path에 중복 비용을 만듭니다.

리팩토링 전 Web은 `updateDoc`·`deleteDoc`를 직접 호출했습니다. 같은 Firestore SDK의 `onSnapshot`은 pending local write를 즉시 반영하므로 서버 확인 전에도 화면이 바뀌었습니다. 현재 단순 지출·자산 create/update/delete에는 애플리케이션 optimistic projection과 모달 선종료가 이미 적용되어 이 체감을 대부분 복원했습니다. 사용자가 현재 수정은 크게 느리지 않다고 확인했으므로 이 경로는 1순위 체감 병목이 아닙니다.

다만 다음 구조적 한계는 남아 있습니다.

- 첫 수정 전에 Command와 projection chunk를 아직 내려받지 못했을 수 있습니다.
- unmerge, split-group 구조 변경, 일부 category·portfolio 흐름은 같은 수준의 projection을 사용하지 않습니다.
- 화면 즉시 반영과 서버 확정은 별개이며, 확정 p95는 여전히 수초입니다.
- 오류 rollback과 Firestore listener 수렴을 애플리케이션이 직접 재구현해야 합니다.

따라서 단순 수정에서 다시 0.5초 이상 모달 종료나 목록 반영이 보인다면 이를 곧바로 Function RTT로 판정하면 안 됩니다. `click → modal close → projection emit → next paint`를 계측해 동적 import, React render, 메인 스레드 경합을 먼저 분리해야 합니다.

### 4.3 자산 수정: 대상 한 건이 아니라 가구 전체 상태를 로드

현재 Portfolio runtime transaction은 한 자산 또는 예수금 한 건을 수정해도 다음 자료를 읽습니다.

- canonical 전체 자산
- legacy 전체 자산
- 전체 asset owner profile
- 전체 asset automation plan
- legacy 전체 stock holding
- legacy 전체 crypto holding
- 각 자산별 canonical positions subcollection

그 뒤 메모리에서 정책을 계산하고 canonical·legacy 자료, history·revision·outbox·receipt를 씁니다. 자산이 `N`개이면 positions query도 최대 `N`개가 되어, 단순 수정이 aggregate 전체 크기에 비례합니다.

이는 수백·수천 사용자를 대비한 확장 장치라기보다 aggregate 일관성을 한 트랜잭션에 몰아넣은 설계입니다. 현재처럼 두 가구를 운영하더라도 **자산 수가 늘면 한 가구 안에서 느려지는 구조**이므로 정리 대상입니다.

자산 화면 조회는 현재 direct Firestore listener로 개선되어 명의자 때문에 Function을 기다리지는 않습니다. 다만 다음 비용은 남아 있습니다.

- 자산 목록은 월 원장·카테고리와 달리 localStorage 선표시 snapshot이 없습니다.
- 첫 listener emission 전까지 `isLoading`이 유지됩니다.
- 이미 Household read model에 가구원이 있어도 자산 명의자 option은 별도 `assetOwnerProfiles` listener 첫 응답을 기다립니다.
- 자산 진입 시 종목 catalog warm-up이 즉시 실행됩니다.
- 첫 자산 표시 뒤 외부 시세 전체 갱신과 전일 snapshot 조회가 이어집니다.
- `/assets`의 첫 JS가 홈보다 큽니다.

종목 검색은 첫 local catalog cache가 없으면 debounce 뒤 IndexedDB hydrate, Cloud Storage manifest와 snapshot 조회, 해시 검증, 압축 해제, JSON parse, 검색 색인 준비를 기다립니다. 같은 검색을 다시 하면 메모리 cache로 빨라지는 현상과 일치합니다. 검색어 매칭 자체는 Function 병목이 아니고, 종목을 선택한 뒤 실시간 quote를 가져오는 단계부터 Function과 외부 공급자가 관여합니다.

### 4.4 Android 결제 알림: Quick Edit이 서버 완료에 종속

리팩토링 전에도 가맹점 규칙, 미매칭 시 기본 카테고리, 등록 카드, 중복, 최종 추가를 위한 보통 4~5개의 직렬 Firestore 단계가 있었습니다. 다만 파싱은 Kotlin에서 즉시 수행했고, Function cold start와 capture receipt 계층 없이 `expenses`를 직접 저장한 뒤 Quick Edit을 열었습니다.

현재 경로는 다음과 같습니다.

1. 알림 원문과 package를 `CaptureEnvelope`로 변환
2. Android Keystore 암호화 journal에 동기 보존
3. Firebase callable 호출
4. Auth·App Check와 Membership 해석
5. TypeScript 파서 실행
6. root capture receipt claim
7. 결제 설정 snapshot 조회
8. Ledger branch transaction
9. root receipt 최종 저장
10. 응답의 `quickEditSnapshot`을 암호화 FIFO에 보존
11. Quick Edit Activity 표시

warm process에서 Membership은 최대 5분, 결제 설정은 최대 1분 cache되지만 `minInstances=0`이고 사용량이 적으므로 cache hit를 보장할 수 없습니다. cold config load는 Household, Member, Category settings, canonical/legacy registered cards, canonical/legacy merchant rules, canonical/legacy categories 등 여러 query를 실행합니다. 이들은 일부 병렬이지만 root receipt와 Ledger transaction 사이에 위치합니다.

정규표현식 파서의 CPU 시간보다 **단말→Function 왕복과 Firestore receipt/config/persistence 단계**가 훨씬 큰 병목으로 판단됩니다. 운영 로그에서도 Android raw의 known-warm p50은 282ms이지만 p90은 1.77초입니다.

현재처럼 서버 parser만 권위로 사용하고 `minInstances=0`을 유지하면 scale-to-zero 직후 첫 결제에서 항상 1초 미만을 보장하기는 어렵습니다. 서버 fast path를 충분히 줄인 뒤에도 목표를 넘는다면 “서버 결과 전에는 Quick Edit을 열지 않는다”는 조건과 “첫 결제도 즉시 연다”는 조건 중 하나는 바꿔야 합니다. 비용을 늘리지 않는 해법은 로컬 provisional Quick Edit을 먼저 보여주고 서버 결과로 수렴하는 방식입니다.

### 4.5 Quick Edit 저장: 서버가 아니라 로컬 내구성 대기

현재 Quick Edit 저장은 서버 응답을 기다리지 않습니다. 대신 다음 두 작업이 끝난 뒤 Activity를 닫습니다.

1. Keystore AES-GCM 암호화 후 SharedPreferences `commit()`으로 outbox fsync
2. WorkManager `enqueueUniqueWork(...).await()`로 영속 실행 예약

두 단계 모두 장애 복구를 위한 올바른 장치지만 foreground 상호작용에서 WorkManager 예약까지 기다리면 수백 ms가 체감될 수 있습니다. 다만 사용자가 현재 수정은 크게 느리지 않다고 확인했으므로 측정 전에는 변경하지 않습니다. 향후 분리하려면 현재 `Application.onCreate()`뿐인 재예약 지점을 `ProcessLifecycleOwner.onStart` 같은 process resume 경계로 확대하고, 비동기 예약 실패 추적·즉시 재시도까지 마련해야 합니다. 그렇지 않고 단순히 `await()`만 제거하면 process가 계속 살아 있는 동안 pending Command가 다음 시작까지 남을 수 있습니다.

### 4.6 콜드 스타트·Function 구성

세 핵심 Function은 현재 1세대이고 `minInstances=0`입니다. 기준 커밋의 `functions/src`는 TypeScript 8개·약 5만 byte였지만 현재는 약 760개·약 249만 byte입니다. compiled `index.js`에서 정적 `require`로 도달하는 로컬 모듈은 측정 환경에서 251개·약 153만 byte였고, fresh Node process의 module require만 약 0.76~0.82초가 걸렸습니다. 이는 Google 플랫폼의 컨테이너 프로비저닝 시간을 제외한 값입니다.

`firebaseHouseholdCommand.ts`는 access, ledger, category, recurring, payment configuration, shortcut, home, portfolio, notification handler를 한 composition root에서 등록하고, Function facade는 capture뿐 아니라 scheduler·admin 등 넓은 graph를 정적으로 연결합니다. 따라서 저빈도 운영에서 scale-to-zero 후 첫 요청은 플랫폼 cold start 외에도 큰 공통 module graph를 로드합니다.

이 구성은 첫 호출을 느리게 할 수 있으나 known-warm 수초 지연을 설명하지 못합니다. 따라서 다음 순서가 맞습니다.

1. 직렬 Firestore 단계 제거
2. 외부 공급자 호출과 단순 Command 분리
3. 그 후 실제 cold/warm 차이를 다시 측정
4. 비용 대비 효과가 충분할 때 특정 경로만 `minInstances=1` 재검토

### 4.7 Firestore Rules의 Membership lookup

리팩토링 전 rules는 주요 collection의 client read/write를 넓게 허용했습니다. 현재는 direct Ledger·Asset listener도 Function을 거치지는 않지만, rules가 `activeMembership()`에서 Membership 문서를 `exists/get`으로 확인합니다. 보안상 필요한 개선이지만 Auth 복원과 rules document access가 direct read의 고정 비용으로 추가되었습니다.

이 비용은 서버 Command의 수초 tail보다 작을 가능성이 높지만 첫 listener가 열리는 시점에는 영향을 줄 수 있습니다. 보안을 낮추는 선택지로 ID token custom claim에 household/member scope를 넣어 rules가 claim만 비교하도록 만들 수 있으나, 멤버 제거·가구 변경이 token refresh 전까지 늦게 반영되는 위험이 있습니다. 적용한다면 짧은 token 갱신 정책과 강제 revoke 절차를 함께 설계해야 하며, 계측 없이 먼저 적용할 항목은 아닙니다.

## 5. 권장 목표 아키텍처

속도를 위해 Clean Architecture를 버릴 필요는 없습니다. **의존성 방향과 업무 모듈 독립성은 유지하되, 배포 경계를 모든 동작에 동일하게 적용하지 않는 hybrid runtime**이 적합합니다.

| 경로 | 권장 실행 위치 | 이유 |
|---|---|---|
| 일반 화면 조회 | rules로 보호된 Firestore read model + 로컬 snapshot | 읽기에서 Function hop 제거, offline/cache 활용 |
| 일반 사용자 쓰기 | 서버 권위 Command + 즉시 optimistic projection | 업무 불변식은 서버에 두고 사용자 반응은 즉시 제공 |
| 단순 Ledger Command | 단일 aggregate transaction | Membership·멱등·업무 쓰기의 중복 직렬화 제거 |
| Portfolio Command | 대상 asset/position 단위 transaction | 전체 가구 상태 로드 제거 |
| Android 결제 수집 | 서버 parser 유지, 전용 fast path | 파서 SSOT 유지와 낮은 지연의 균형 |
| 외부 시세·공시 | 저장된 마지막 성공값을 우선 표시하고 background refresh | 공급자 지연이 기본 화면을 막지 않음 |

Clean Architecture가 요구하는 것은 “모든 요청이 Function을 통과하는 것”이 아니라, Domain이 Firebase·React·Android에 의존하지 않고 Use Case와 Port가 명확한 것입니다.

## 6. 해결 방안과 우선순위

### P0. 단계별 계측부터 추가

현재 Function 이름 단위 로그만으로는 어떤 Command가 p95를 올리는지 구분할 수 없습니다. 다음 필드를 PII 없이 기록해야 합니다.

- 공통: correlation ID, command/query 종류, instance boot ID, process invocation sequence
- Web: 클릭→optimistic paint, Auth 준비, App Check 준비, callable 시작·종료, listener 확정
- Command: Actor 해석, 공통 receipt, handler, domain repository, outbox, 외부 provider
- Android: 알림 수신, journal 완료, callable 시작, 서버 저장, snapshot 저장, Activity 표시

초기 목표치는 다음과 같이 둡니다.

| 사용자 경험 | 목표 |
|---|---:|
| 유효한 local snapshot이 있는 첫 paint p95 | 500ms 이하 |
| 수정 후 사용자에게 보이는 반영 p95 | 100ms 이하 |
| 단순 Ledger 서버 확정 p95 | 1초 이하 |
| Android 알림→Quick Edit 표시 p95 | 1초 이하를 목표로 측정 후 조정 |

### P1. 첫 화면과 Android 결제 표시

1. 이미 구현된 last-verified session·가구·월 원장·카테고리 선표시 fast path를 유지하고, 실제 단말에서 cache-hit 여부와 `bootstrap → first paint` 시간을 기록합니다. cache hit인데도 full-screen Guard가 보이면 cache decode·버전·UID 불일치 원인을 먼저 수정합니다.
2. 같은 UID의 last-verified Membership이 있으면 별도 Membership Callable을 첫 paint 경쟁 경로에서 제거하고 background 재검증 주기를 둡니다.
3. 캐시 없는 첫 로그인도 Membership query + canonical 3문서 재검증 대신 단일 signed-in membership projection을 읽습니다.
4. Android custom-token 응답에 Membership뿐 아니라 최소 Household header read model을 함께 반환해 별도 Household read를 없앱니다.
5. 홈 첫 데이터가 표시되기 전에는 종목 catalog·자산 listener·Command chunk prewarm을 실행하지 않습니다. navigation intent 또는 더 긴 idle 시점으로 옮깁니다.
6. Functions를 access·capture·interactive command·provider/scheduled처럼 배포 codebase 또는 entry graph로 분리해 첫 capture가 scheduler·admin graph를 로드하지 않게 합니다.
7. Android capture configuration을 한 projection read로 만들고 receipt·Ledger 저장을 가능한 한 단일 transaction으로 합칩니다.
8. Quick Edit 저장은 현재 우선순위가 아닙니다. WorkManager 예약 시간이 실제 지연의 유의미한 비중으로 측정될 때만 process-resume 재예약과 예약 실패 추적을 먼저 추가한 뒤 foreground 대기 분리를 검토합니다.

### P2. Command 내부 구조 개선

1. **이중 receipt 제거**
   - 공통 router receipt와 Domain receipt 중 하나만 원자적 멱등 경계로 사용합니다.
   - 합쳐진 receipt는 `principalUid + tenant + canonical idempotency key`, 전체 payload fingerprint mismatch, processing lease, replay 결과를 보존해야 합니다.
   - 권장안은 Domain transaction이 aggregate 변경, outbox, receipt를 함께 commit하고 router는 결과를 전달만 하는 방식입니다.

2. **canonical/legacy hot-path 종료**
   - migration reconcile을 실행해 두 가구의 canonical 무결성을 확인합니다.
   - 현재 Web은 top-level `expenses`, `assets`, `stock_holdings`, `crypto_holdings`를 직접 읽으므로 server write만 먼저 canonical-only로 바꾸면 화면이 멈춥니다.
   - 먼저 이 flat collection을 의도된 read model로 승격해 outbox projector가 계속 갱신할지, Web listener·rules·index를 canonical nested 경로로 옮길지 결정합니다.
   - 안전한 cutover 순서는 `consumer·rules·index 전환 → canonical/기존 view 대조 검증 → legacy dual-write 중단 → 관리용 migration/복구 경로만 보존`입니다.

3. **Membership 조회를 한 문서로 축약**
   - 요청마다 Membership과 Household를 반복 확인하지 않도록 UID와 household가 직접 키로 연결된 active membership projection 하나를 사용합니다.
   - 가구 lifecycle에 필요한 최소 상태를 projection에 포함하고, 삭제·권한 변경 Command가 원자적으로 갱신합니다.

4. **Ledger 단순 변경을 한 트랜잭션으로 축약**
   - 대상 canonical transaction, receipt, outbox만 읽고 씁니다.
   - update/delete에 전체 category catalog나 legacy 문서를 읽지 않습니다.

5. **Portfolio를 대상 aggregate 단위로 변경**
   - 자산 수정은 해당 asset 하나, 포지션 수정은 해당 asset과 position 하나만 읽습니다.
   - 전체 상태가 필요한 순서 변경·일일 snapshot 같은 Use Case만 별도 bulk path로 둡니다.

6. **Android capture configuration을 단일 projection으로 제공**
   - 카드·규칙·기본 카테고리 변경 Command가 `captureConfigurationSnapshot` 한 문서를 갱신합니다.
   - raw capture는 Membership projection, capture config 한 문서, Ledger 한 트랜잭션만 거치게 합니다.

### P2. 추가 화면 체감 개선

1. 원장·카테고리처럼 자산 목록과 명의자에도 versioned local snapshot을 둡니다.
2. Household members를 자산 명의자 option에 즉시 seed하고, 별도 asset-only profile만 listener 결과로 merge합니다.
3. 종목 catalog manifest 확인과 snapshot 갱신은 background에서 수행하고 마지막 검증 catalog로 검색을 즉시 시작합니다.
4. 첫 화면에 필요하지 않은 Firebase Functions, App Check, portfolio provider 코드는 route/chunk로 더 강하게 분리합니다.
5. 단순 수정 UI에 지연이 다시 관찰될 때만 optimistic projection 누락과 main-thread render를 계측·보완합니다.

### P2. Android Quick Edit의 후속 선택지

권장 순서는 다음과 같습니다.

1. 먼저 서버 fast path를 Membership projection 1회 + capture config 1회 + Ledger transaction 1회로 줄입니다.
2. 그래도 알림→표시 p95가 목표를 넘으면 알림을 받은 즉시 “처리 중” Quick Edit shell을 띄우고 서버 snapshot 도착 시 form을 채우는 방식을 검토합니다.
3. 최후 수단은 기기 parser를 provisional preview 용도로만 두고 서버 parser 결과로 수렴하는 방식입니다. 다만 parser 이중화 비용이 커 우선 권장하지 않습니다.

### P3. 외부 공급자와 자산 화면 분리

- 자산 기본 화면은 저장된 마지막 성공 시세만으로 즉시 그립니다.
- 전체 시세 갱신은 화면 표시 후 background job으로만 수행합니다.
- 공급자 호출 Command/Query를 일반 사용자 Command 통계와 분리합니다.
- 종목 catalog는 IndexedDB·Cloud Storage snapshot을 우선 사용하고 첫 페이지 네트워크와 경쟁시키지 않습니다.
- 공급자별 timeout, circuit breaker, 마지막 성공값 fallback을 유지합니다.

### P4. 인프라 조정

- 현재 규모에서는 `minInstances=0`을 유지합니다.
- P1 적용 후에도 Android raw cold p95만 유의미하게 남을 때 해당 Function 한 개에 한해 warm instance를 재검토합니다.
- 2세대 Functions, 메모리 증설, handler별 Function 분할은 계측 후 적용합니다. 이들은 직렬 Firestore transaction을 대신 해결하지 못합니다.
- CORS preflight는 부차적 비용입니다. callable 계약을 유지한다면 cache 정책을 확인하되, 이를 없애기 위한 별도 proxy가 오히려 hop을 하나 더 만들지 검증해야 합니다.

## 7. 실행 순서

1. 첫 화면과 Android capture에 단계별 latency telemetry를 추가합니다.
2. 실제 단말에서 session·월 원장 cache hit와 full-screen Guard 노출 여부를 확인하고, 반복 Membership 검증과 초기 background prewarm 경쟁을 제거합니다.
3. Access·Capture Function의 배포 graph를 scheduled·admin·provider graph에서 분리합니다.
4. Android capture config projection과 축약된 persistence transaction을 구현합니다.
5. 자산·명의자 local snapshot과 종목 catalog stale-while-revalidate를 적용합니다.
6. 위 변경 후에도 서버 확정 tail이 크면 Ledger Command 하나를 pilot으로 골라 이중 receipt를 통합합니다.
7. consumer·rules·index 전환과 대조 검증 후 canonical/legacy dual-write를 종료합니다.
8. Portfolio targeted transaction으로 전환합니다.
9. 측정 결과로만 min instance 또는 2세대 전환을 판단합니다.

이 순서는 대규모 사용자를 위한 확장 장치를 더 추가하는 계획이 아닙니다. 현재 두 가구의 실제 hot path에서 불필요한 왕복과 전체 aggregate 로드를 제거하는 계획입니다.

## 8. 완료 판정

다음 조건을 모두 만족해야 “서버 중심 리팩토링의 성능 회귀가 해소되었다”고 판단합니다.

- 캐시 있음·없음, Android WebView·iPhone PWA를 구분한 첫 화면 지표가 존재합니다.
- Ledger update/delete의 서버 경로에 멱등 receipt가 한 계층만 존재합니다.
- 운영 Command가 legacy collection을 읽거나 쓰지 않습니다.
- 자산 한 건 수정이 전체 자산·전체 positions query를 실행하지 않습니다.
- Android raw capture가 결제 설정 여러 collection을 매번 조합하지 않습니다.
- optimistic 표시가 안전한 일반 Ledger·Portfolio 수정은 100ms 안에 결과를 표시하고 실패 시 명확히 rollback합니다.
- warm p95 수초 outlier의 Command 종류와 내부 단계가 로그에서 식별됩니다.
- 상시 인스턴스 없이 목표를 만족하는지 먼저 검증합니다.

## 9. 주요 코드 근거

- 첫 화면 session·cache bootstrap: [`HouseholdContext.tsx`](../../web/src/contexts/HouseholdContext.tsx)
- 첫 화면 Guard: [`HouseholdGuard.tsx`](../../web/src/components/HouseholdGuard.tsx)
- 로그인 후 prewarm 작업: [`AppProviders.tsx`](../../web/src/components/AppProviders.tsx)
- Signed-in Membership 해석: [`firebaseSignedInUserResolver.ts`](../../functions/src/adapters/firebase/access/firebaseSignedInUserResolver.ts)
- Function 전체 export graph: [`firebaseFunctionFacade.ts`](../../functions/src/bootstrap/firebaseFunctionFacade.ts)
- 공통 Command Actor·receipt 경계: [`householdCommandRouter.ts`](../../functions/src/bootstrap/commands/householdCommandRouter.ts)
- 공통 Membership·receipt Firestore Adapter: [`firebaseHouseholdCommandInfrastructure.ts`](../../functions/src/adapters/firebase/commands/firebaseHouseholdCommandInfrastructure.ts)
- Ledger 업무 receipt와 canonical/legacy commit: [`firebaseLedgerCommandRepository.ts`](../../functions/src/adapters/firebase/ledger/firebaseLedgerCommandRepository.ts)
- Portfolio 전체 상태 로더: [`firebasePortfolioRuntimeStateLoader.ts`](../../functions/src/adapters/firebase/portfolio/firebasePortfolioRuntimeStateLoader.ts)
- 종목 catalog 첫 초기화: [`localStockInstrumentCatalog.ts`](../../web/src/features/portfolio/instrument-catalog/application/localStockInstrumentCatalog.ts)
- Cloud Storage 종목 snapshot Adapter: [`firebaseStorageStockInstrumentCatalogRemote.ts`](../../web/src/platform/instrument-catalog/firebaseStorageStockInstrumentCatalogRemote.ts)
- direct read의 Membership rules: [`firestore.rules`](../../firestore.rules)
- Android raw 결제 제출: [`AndroidCaptureDelivery.kt`](../../android/app/src/main/java/com/household/account/paymentcapture/AndroidCaptureDelivery.kt)
- Quick Edit outbox·WorkManager 예약: [`QuickEditCommandDelivery.kt`](../../android/app/src/main/java/com/household/account/quickedit/QuickEditCommandDelivery.kt)

## 10. 2026-07-23 1차 적용 결과

이번 분석에서 우선순위가 높았던 항목 중 다음을 구현했습니다.

- Web은 같은 UID의 마지막 검증 Membership을 30분 동안 시작 hint로 사용하고, 만료된 검증은 첫 원장 paint 뒤 idle에서 갱신합니다.
- 캐시된 화면 표시의 선행 조건이 아닌 Firebase Auth SDK는 별도 동적 청크로 분리했습니다. 종목 카탈로그도 자산 첫 paint 뒤 동적 로딩으로 옮겼습니다. 로컬 production 빌드에서 `/` First Load JS는 317 kB에서 291 kB로, `/assets`는 395 kB에서 368 kB로 줄었습니다.
- 첫 화면과 경쟁하던 command·자산·종목 catalog 고정 timer prewarm을 제거했습니다. command prefetch는 첫 원장 paint 뒤로, 자산과 종목 catalog는 `/assets` 링크의 pointer/focus 의도 시점으로 옮겼습니다.
- 자산과 자산 명의자는 가구별 localStorage snapshot으로 첫 paint를 복원한 뒤 Firestore listener로 수렴합니다.
- Android 결제 설정의 여러 원본 조회 경로 앞에 가구별 단일 Firestore projection을 두었습니다. 카드·규칙·카테고리 변경 transaction이 projection을 무효화하고 miss 재생성도 transaction으로 수행합니다.
- Web 첫 원장 paint, Functions 내부 단계, Android 알림 수신부터 Quick Edit 표시까지 개인정보 없는 계측을 추가했습니다.
- `minInstances=0` 결정은 유지합니다.

로컬 측정 절차는 [로컬 대화형 지연 계측](../operations/local-interactive-latency-measurement.md)을 따릅니다. 앱 모듈 평가 뒤의 내부 measure뿐 아니라 Navigation Timing부터 첫 원장 paint까지를 함께 봐야 정적 JS 다운로드·파싱 시간이 빠지지 않습니다. 실제 Cloud cold start와 통신망을 포함한 전후 비교는 배포 뒤 같은 `revision`·cache 조건으로 수행해야 합니다.
