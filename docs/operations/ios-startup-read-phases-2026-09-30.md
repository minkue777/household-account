# iPhone 시작 인증·Firestore 읽기 구간 관측 보강

## 목적과 확인된 한계

`ADM-006` / `T-ADM-005`의 iPhone PWA 시작 진단에 선택 관측을 추가합니다.
화면 완료 조건, 접속 집계, 전체 홈 paint 시간은 유지하며 제품 속도를 바꾸는 작업은 아닙니다.

확인된 8.357초 표본은 navigation 기준 bootstrap 1.918초, auth 시작 1.969초와
완료 3.087초, household 시작 3.438초와 완료 8.208초, homeReady 8.238초,
최종 paint 8.357초입니다. 관측된 hiddenMs는 0이고 연간 합계는 필요하지 않았습니다.
기존 필드만으로 인증 관측, 읽기 요청 시작, 서버 snapshot 도착, 이후 mapping·상태 반영을
분리할 수 없으므로 이 표본의 4.770초 household 구간을 서버 처리 시간으로 단정하지 않습니다.

## 선택 필드의 의미

모든 새 필드는 `clientStartupDiagnostics` version 1의 `timingsMs`에 추가하는
navigation 기준 밀리초 offset입니다. 단계별 소요 시간이 아니며 병렬 구간을 합산하지 않습니다.
관측이 없으면 생략하고 0 또는 다른 단계 값으로 대체하지 않습니다.

| 필드 | 최초 관측 시점과 해석 |
|---|---|
| `authTokenObserved` | 기존 Firebase `onIdTokenChanged`에서 `user != null`을 관측한 시점입니다. Firestore 내부 `getToken` 완료나 Firestore 요청에 토큰이 적용된 시점이라는 뜻은 아닙니다. |
| `authTokenRequestStarted`, `authTokenResponseEnd` | 지원되는 브라우저에서 이미 완료된 `securetoken.googleapis.com/v1/token` Resource Timing의 `startTime`·`responseEnd`입니다. `startTime`은 연결 준비를 포함한 브라우저 리소스 요청 시작이며 순수 HTTP 전송 시작이 아닙니다. HTTP 실패도 관측될 수 있으며 성공이나 유효한 token 취득을 보장하지 않습니다. 이 관측을 위해 토큰 갱신이나 별도 요청을 만들지 않습니다. |
| `householdReadStarted`, `householdSnapshotReceived` | 실제 가구 metadata 서버 조회를 호출하기 직전과 조회 snapshot을 받아 mapper를 실행하기 전입니다. 기존 `householdStarted` / `householdReady`의 의미는 유지합니다. |
| `ledgerListenStarted`, `ledgerServerSnapshotReceived` | 월 원장 구독 호출 직전과 최초 서버 snapshot callback 진입 시점입니다. snapshot 도착은 mapper 실행 전에 기록합니다. |
| `categoriesListenStarted`, `categoriesServerSnapshotReceived` | 카테고리 구독 호출 직전과 최초 서버 snapshot callback 진입 시점입니다. snapshot 도착은 mapper 실행 전에 기록합니다. |
| `currencyPreferencesListenStarted`, `currencyPreferencesServerSnapshotReceived` | 지역화폐 설정 구독 호출 직전과 최초 서버 snapshot callback 진입 시점입니다. snapshot 도착은 mapper 실행 전에 기록합니다. |
| `currencyBalancesListenStarted`, `currencyBalancesServerSnapshotReceived` | 지역화폐 잔액 구독 호출 직전과 최초 서버 snapshot callback 진입 시점입니다. snapshot 도착은 mapper 실행 전에 기록합니다. |
| `yearSummaryListenStarted`, `yearSummaryFirstSnapshotReceived`, `yearSummaryServerSnapshotReceived` | 연간 합계 구독 호출 직전, 최초 callback, 최초 서버 snapshot callback 진입 시점입니다. 최초 callback은 캐시일 수 있으므로 서버 도착과 별도 필드로 보존하며 둘 다 mapper 전에 관측합니다. |

token Resource Timing은 유한한 `startTime >= 0`, `responseEnd > 0`,
`responseEnd >= startTime`, `responseEnd <= 전체 시간`인 완료 entry 중 가장 이른
`startTime`의 쌍을 사용합니다. `requestStart`는 Timing-Allow-Origin 제한으로 가려질
수 있어 사용하지 않습니다. API 미지원, entry 누락, 유효한 쌍을 관측할 수 없는 경우
두 필드 모두 생략하며, 관측이 없다는 사실만으로 token 캐시 hit을 확정하지 않습니다.

서버 snapshot은 캐시 snapshot과 구분합니다. 최초 callback이 서버 snapshot이면
연간 합계의 first/server 관측이 같을 수 있으며, 캐시 callback 이후 서버 관측이 없으면
first만 존재할 수 있습니다. 새로운 관측을 기다리느라 기존 readiness를 늦추지 않습니다.
`authReady`, `householdReady`, `ledgerReady`, `categoriesReady`, `localCurrencyReady`,
`yearSummaryReady`, `homeReady`와 두 paint의 기존 의미는 그대로 둡니다.
최종 방문 기록 이후 도착하는 callback·Resource Timing 관측은 무시하고 재전송/추가 로그를 만들지 않습니다.

구독 callback 계측은 구독이 active이고 캡처한 scope가 현재 `getClientSessionScope()`와
동일하며 요청 household도 일치할 때만 수행합니다. 이 조건은 계측만 제한하며 기존
callback의 데이터 전달·오류 흐름은 바꾸지 않습니다. 연간 구독의 기존 metadata 옵션도
유지합니다. 가구 metadata 백그라운드 갱신은 homeReady의 필수 조건이 아니므로 가구
조회 시각의 누락을 허용하고, 관측되었을 때만 조회 직전과 수신의 일관성을 검사합니다.

구독 시작과 서버 snapshot 사이에는 SDK 인증 대기, 연결, 네트워크, 서버 처리와 callback
스케줄링이 포함될 수 있습니다. Resource Timing도 특정 Firestore 요청이 어느 토큰을
사용했는지를 입증하지 않으므로 각 차이를 단일 원인의 처리 시간으로 해석하지 않습니다.

## 서버 계약·호환성·개인정보

기존 `access.record-app-visit.v1` 요청의 선택 진단에 허용 키만 추가합니다.
새 필드 16개는 모두 선택이며 기존 v1 진단, 진단 없는 구버전 요청, Android·일반 Web의
기존 처리를 유지합니다. 스키마 버전이나 준비 완료 기준을 바꾸지 않습니다.
서버 수용을 먼저 배포하고 이후 Web을 배포합니다.

서버는 기존과 동일하게 모든 시각의 유한한 숫자·0 이상·전체 시간 이하 조건과 소수점
셋째 자리 반올림을 적용합니다. 키 순서나 단계 사이의 선후 관계를 새 거부 조건으로
도입하지 않습니다. 임의 키·손상 값이 있으면 진단만 생략하고 유효한 접속과 총시간은
기록합니다. 허용된 선택 키는 handler와 실제 구조화 logger의 검증을 모두 통과해야 합니다.

URL 원문·query·토큰·사용자/가구/거래 식별자·snapshot 자료·금액·메모는 수집하거나
기록하지 않습니다. 토큰 endpoint는 클라이언트에서 일치 여부만 확인하고 시각 숫자만
보존합니다. 기존 `interactive-latency.v1` / `clientStartup` / `total` 로그 하나에
포함하며 별도 진단 문서, 추가 네트워크 요청, polling을 만들지 않습니다.

## 검증 계획

| 계약 | 검사 |
|---|---|
| 신규 16개 선택 키 수용·복사·반올림, 0/전체 시간 경계, 숫자 아닌 값·음수·초과·비유한 값 거부, 허용 목록, 기존 v1 진단 보존 | `functions/test/observability/client-startup-diagnostics.test.ts` |
| 신규 관측이 handler와 실제 logger를 지나 같은 total 로그에 보존, 동일 visit 재전송 1회, 손상 진단의 기존 접속·전체 시간 무간섭, 진단 없는 구버전/Android 동작 | `functions/test/bootstrap/member-access-app-visit-latency.test.ts` |
| 최초 관측만 보존·최종 기록 후 무시·Resource Timing 지원/미지원·endpoint 제한·토큰 관측의 의미·추가 요청 없음 | Web 진단 계약 및 인증 adapter 검사 |
| 조회 직전 시작·mapper 전 callback·캐시/서버 분리·연간 최초 캐시와 서버 관측·기존 readiness 유지 | Web read-model 및 초기 홈 회귀 검사 |
| 운영 배포 후보와 기존 시작 계약의 실제 연결 | Functions/Web 타입 검사와 production build, 기존 iPhone 시작 E2E 및 대상 배포 검증 |

집중 서버 검사 결과: `npm test -- --run test/observability/client-startup-diagnostics.test.ts
test/bootstrap/member-access-app-visit-latency.test.ts`의 2개 파일 75개 검사가 통과했습니다.
신규 16개 선택 시각, 각 키의 경계·반올림·손상 값, 실제 logger 보존·재전송 1회,
손상 진단 무간섭과 기존 v1 보존을 확인했습니다.
Functions `npm run test:types`도 통과했습니다.

Web 검증 결과:

- 인증·진단 수집 계약 4파일 30개가 통과했습니다. 실제 Resource Timing의 `startTime` 사용,
  endpoint 제한·원문 비보존·미관측/오류 무간섭·동결과 추가 토큰 조회가 없음을 확인했습니다.
- [read 서비스 계측 계약](../../web/src/__tests__/features/homeStartupReadDiagnostics.contract.test.ts)을
  포함한 서비스·기존 scope/Android 회귀 8파일 130개가 통과했습니다. 실제 수집기와 scope를
  사용해 mapper 전 관측, 캐시/서버 구분, 취소·세션 교체 응답 제외를 확인했습니다.
- Web `tsc --noEmit`과 E2E의 production build가 통과했습니다. 준비 단계의 Functions
  architecture 45개, 세 codebase 준비도 통과했습니다.
- 실제 iPhone WebKit·Auth/Firestore SDK·Firebase Emulator E2E 1개가 통과했습니다
  (검사 8.4초, 전체 40.2초). 빈 잔액의 첫 서버 snapshot, 재실행 로그인 유지·최신 자료,
  구독→callback→준비→paint 시각과 문서당 방문 기록 1회를 확인했습니다.
  실제 서버 stdout의 초기/재실행 두 `clientStartup` 로그에도 신규 시각이 보존됐습니다.
- 요구사항 catalog(248개/234개 canonical 테스트)·E2E 추적성 검사와 diff 검사가 통과했습니다.
  E2E 종료 후 웹 서버와 Firebase 에뮬레이터가 정상 종료됐습니다.

로그는 저장소 밖 `TEMP/household-ios-read-phases-{prepare,e2e}-20260930.log`입니다.
개발 PC의 Emulator/WebKit 결과와 운영 iPhone의 체감 속도는 구분하며 추가 관측 전에는
기존 표본의 병목을 확정하지 않습니다.

## 서버 선행 배포

2026-10-01 지역화폐 취소 수정과 함께 구현 후보
`66929412791ea95deed300dc0af7c69fef2435e2`를 세 Functions codebase에 배포했습니다.
release는 `release-20261001-gyeonggi-cancellation-6692941`이며 실제 로그인·가구 조회의
release/commit/artifact marker 검증과 provenance 기록이 완료됐습니다. 새 선택 필드를
수용하는 서버 배포 이후 main push로 Web Git 자동배포를 진행합니다. CI와 Web 배포는
최종 push SHA를 기준으로 별도 확인하며 이 계측 배포를 실행 지연 해결로 판단하지 않습니다.
