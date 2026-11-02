# 토스 엔화 알림의 고정 원화 환산

현재 표시 계약은 원화만 표시하는 것이다. 최초 배포 후 사용자가 엔화 표시 제거를 요청했으며 아래 계약을 갱신했다. 초기 배포와 검증 이력은 실행 결과에 보존한다.

## 계약

- 입력: 등록된 토스 앱의 `16,248 JPY 결제` / `결제 취소`와 `토스뱅크 체크카드 | 가맹점` 원문. 계좌 잔액·다른 통화·잘못된 금액은 결제액으로 추정하지 않는다. 기존 가맹점·본인 카드·권한 판정은 유지한다.
- 결과: 서버에서 원 단위 반올림한 `amountInWon`을 기존 원장·QuickEdit·통계 계약에 전달한다. 목록·검색·날짜/카테고리 상세·수정은 원화만 표시한다. 엔화·환율·보조 환산 문구는 표시하지 않는다. 합계도 같은 원화 금액이다.
- 저장: `foreignPayment = { currency: 'JPY', amount, rateInWon, rateDate, provider: 'frankfurter-ecb' }`를 원장과 불변 수집 기록에 저장한다. 등록 후 환율을 다시 계산하지 않는다. 일반 수정은 서버에서 증거를 보존하며 원화 반영액만 바꾼다. 분할·합치기는 기존 원화 계약을 사용하며 파생 거래에 원금 전체를 복제하지 않는다.
- 실패: 환율 실패·유효하지 않은 응답·결제일 이후 환율·원화 정수 범위 초과는 `EXCHANGE_RATE_UNAVAILABLE`과 `partial-retryable`을 반환한다. 원장을 생성하거나 terminal receipt로 확정하지 않는다.
- 멱등성·취소: 원문 hash와 기존 receipt 계약을 유지한다. 외화 승인 fingerprint와 취소 금액 비교는 통화·원금으로 한다. 환율 변동이 중복 거래를 만들거나 정상 전액 취소를 막지 않는다. 원화 취소와 외화 승인은 교차 연결하지 않으며 카드·가맹점·30일 범위·유일 후보·원자적 lineage 취소는 유지한다.

## 환율

기존 시세 코드가 쓰는 Frankfurter의 v2 API에서 ECB 제공값만 조회한다. `GET /v2/rate/JPY/KRW?date=YYYY-MM-DD&providers=ECB`이며 결제일 이전 또는 당일의 실제 응답 고시일을 저장한다. 주말은 직전 고시일이 될 수 있다. 환율은 카드사 실제 청구 환율이 아닌 통계용 추정값이며 환율·고시일·출처는 서버 기록에만 보존한다.

출처: <https://frankfurter.dev/>. 결제 정보·가구 정보는 외부로 보내지 않으며 날짜와 통화쌍만 전달한다. HTTPS 고정 호스트, 5초 제한, 16KiB 응답 제한, 5분/32일 캐시를 사용한다. 운영 어댑터 읽기 전용 조회에서 2026-10-30은 1엔당 8.4913원, 고시일 2026-10-30으로 확인했다.

## 검증

- 원문 → parser → receipt → 원장 경로와 환율 reader·기존 취소 검사: 5파일 161검사 통과.
- 실제 Firestore Emulator: `capture-financial-flow.integration.test.ts` 6검사 통과. 외화 저장, 재전송, 환율 변경 후 중복, 원화 취소 거부, 엔화 취소·재전송 포함.
- Web: 외화 표시·원화 합계·편집 응답·태그 mapping·저장 pipeline 3파일 22검사 통과.
- Functions architecture 43검사, 테스트 타입 검사, 런타임 경계 0위반. Web 전체 타입 검사 통과.
- Web 타입 검사에서 기존 `portfolio.refresh-market-values.v1` 요청 타입의 선택 `assetId` 누락도 발견해 서버가 이미 지원하는 계약에 맞췄다.

## 배포 범위

공용 Functions 소스이므로 세 codebase를 선행 배포하고 Web은 main Git 배포를 사용한다. 원문 전송 Android와 공개 capture 입력은 바꾸지 않아 APK 갱신은 없다. 기존 원화 거래와 구형 클라이언트는 선택 외화 필드를 무시할 수 있다. 수정 응답에 추가된 선택 외화 필드도 같은 의미의 기존 필드를 바꾸지 않는다.

기존 일본 여행 수동 지출이나 과거 실패 알림은 재처리하지 않는다. 이번 요청으로 승인되지 않은 운영 원장 변경·백필은 수행하지 않는다. 배포 및 원격 CI 결과는 완료 후 아래에 기록한다.

## 실행 결과

- 제품 commit `17708daeeeaf24b01351429e467c7e7df2259d01`을 `release-20261102-toss-yen-17708dae`로 Firebase 세 codebase에 배포했다. wrapper 기본 smoke의 release·commit·artifact marker와 비인증 거부 검사를 통과했다. 실제 사용자 로그인·신규 운영 결제 생성 검사는 수행하지 않았다.
- 기존 조회에서 보관한 일본 토스 원문 10개(중복 포함, 고유 결제 9개)를 배포 parser로 로컬에서 읽어 모두 JPY 원금·가맹점·수신 시각 인식을 확인했다. 운영 저장이나 과거 알림 재등록은 하지 않았다.
- 서버 선행 배포 완료 후 제품 commit을 main에 push했다. Web production build와 산출물 검증은 성공했다. 빌드 중 기존 Firebase SSR 경고가 출력됐으며 명령 exit 0과 12개 HTML·26개 CSP hash·단일 root worker 검증 완료를 확인했다.
- 원화 환산액은 최초 등록 값으로 고정한다. 사용자 추가 확인에도 조회·환율 변동에 따른 과거 금액 재계산은 하지 않는 계약을 재확인했다.
- 해당 제품 SHA의 [Vercel Git 배포](https://vercel.com/irubias-projects/minkue777-household-account/ATV7GMYPKTX5Qa3cpZuW2fCmHiuG)는 success이며 GitHub Production deployment `7482096256`도 완료됐다. 운영 `https://household-account-app-demo-v1.vercel.app/`와 `/sw.js`의 HTTP 200·응답 형식을 확인했다.
- 제품 CI [41372335385](https://github.com/minkue777/household-account/actions/runs/41372335385)는 실행 중이다. Android instrumentation job은 변경 범위 판정 성공이며 이번 변경의 새 native 실행을 주장하지 않는다. 나머지 네 검사·결과 요약은 후속 확인한다. 이 결과 기록만 바뀌는 후속 commit은 재배포 대상이 아니다.

## 원화 표시로 통일

사용자가 퀵에딧과 동일하게 모든 화면을 원화로만 표시하도록 요청했다. 목록 네 곳의 기존 원화 표시를 복원하고 수정 화면의 엔화·환율 안내를 제거했다. 사용하지 않게 된 `ExpenseAmount`, Web의 외화 타입·증거 Mapper도 제거했다. 서버 원금 보존·고정 원화 환산·중복·취소 정책은 유지하며 운영 데이터 변경은 없다. Web Git 배포만 필요하고 Firebase·APK는 변경하지 않는다.

표시 검사는 외화 증거가 있는 원장의 원화 내역·월 합계·엔화 표시 없음, 조회 시 재환산 없음, 수정 응답 금액 반영을 검증하도록 현재 계약에 맞췄다. 초기 기능의 원금 보존·취소 검사는 서버에 그대로 유지한다.

현재 표시·수정 저장 pipeline의 두 파일 18검사와 Web production build의 타입·산출물 검증이 통과했다. 엔화 전용 UI 검사는 제거한 기능을 기대하지 않도록 바꾸고, 실제 원화 화면과 금액 보존 검사는 유지했다.
