# Portfolio·운영·PWA 실제 실행 경계 E2E 매핑

요구사항 문서의 현재·목표 표기를 그대로 신뢰해 테스트 수만 채우지 않습니다. 아래는 실제 구현의 실행 경계와 새 테스트가 확인하는 결과입니다. 같은 ID의 일부 정상 흐름이 통과했다고 모든 예외·운영 배포 조건까지 충족했다고 해석하지 않습니다.

## 실행 경계

- `web/e2e/portfolio-journeys.spec.ts`: 실제 브라우저 → Firebase Auth Emulator → Household callable → 실제 Application/Firestore 트랜잭션 → Client SDK 구독 → 화면입니다.
- `web/e2e/portfolio-reporting.spec.ts`: 과거 Snapshot/수집된 배당 공시만 Emulator에 준비하고 실제 통계 SDK 읽기·UI를 실행합니다. 기간마다 **다른 기준 금액**을 주어 버튼이 아무 일도 하지 않아도 통과하던 검증을 방지합니다.
- `web/e2e/portfolio-provider-jobs.spec.ts`: 실제 export된 Scheduler `run` → 실제 SafeExternalHttpClient/Provider parser → 실제 평가 Application → Emulator 저장 → 통계 화면입니다. Cloud Scheduler 전달 및 외부 사업자의 **HTTP 응답만** fixture로 대체합니다. SDK/Domain/Repository 구현을 복제하지 않습니다.
- `web/e2e/portfolio-market-catalog.spec.ts`: Cloud Storage HTTP의 작은 gzip 카탈로그만 fixture로 대체합니다. 실제 Storage SDK의 generation/SHA-256/gzip/schema 검증, IndexedDB 저장·복원, 앱 검색이 실행됩니다.
  - 2026-09-11 production E2E에서 실제 CSP의 Storage origin 누락으로 `latest.json` 요청이 차단되는 결함을 발견했습니다. 보안 정책에 `https://firebasestorage.googleapis.com`만 추가했으며 CSP 우회 없이 같은 검색 경로를 재검증합니다. dev 통과만으로 운영 카탈로그 다운로드를 보장할 수 없었던 사례입니다.
- `web/e2e/admin-portfolio.spec.ts`: Cloud Logging의 서비스 계정 자격 취득과 정확한 `entries:list` HTTP 응답만 E2E 전용 preload로 대체합니다. 실제 사용자 Auth JWT·관리자 권한·Reader의 원시 로그 파싱·correlation 재시도 중복 제거·통계 집계·callable·UI를 실행합니다. 성공 1초/3초 두 표본, 같은 요청의 오래된 실패 9초, 숫자가 아닌 시간을 넣고 화면의 호출 2회·성공 2/2·평균 2.000초·P95/최대 3.000초 및 실제 provider 요청의 project/filter를 검증합니다. Google ADC/IAM과 운영 로그 수집 인프라 자체는 이 E2E 범위가 아닙니다.
- `web/e2e/admin-portfolio.spec.ts`: Auth Emulator custom claim만 관리자 시작 조건으로 준비합니다. 관리자 callable, 업무 권한 거절, 복구 트랜잭션 및 실제 Admin/조회 전용 화면을 실행합니다.
- 알림 E2E의 FCM 경계는 `tools/e2e/firebase-fcm-transport.cjs`가 Admin SDK의 `Messaging.send()` 외부 발송 호출·응답을 대신하는 지점입니다. 실제 Command·Outbox trigger·수신자 선택·Delivery Adapter·전송 기록·endpoint 상태 변경을 실행하고, 전송하려던 대상/메시지와 저장 결과를 함께 확인합니다. 이 결과는 FCM 서버 접수·APNs 전달·실제 휴대폰 표시의 성공을 뜻하지 않습니다. 사용자 Auth JWT와 Firestore 권한 검증은 대체하지 않습니다.
- `web/e2e/home-preferences.spec.ts`: 사용자 UI에서 없앤 홈 카드 편집기를 되살리지 않고 실제 설정 callable → SDK 구독 → 홈 표시를 검증합니다. 테마는 실제 설정 UI를 사용합니다.
- `web/e2e/pwa-authenticated.spec.ts`: Emulator 설정의 **production build**에서 실제 로그인·홈 paint가 일어난 뒤 앱의 지연 Worker 등록과 사용자 갱신/로그아웃을 검증합니다.
- `web/e2e-pwa`: production build의 CSP/hydration/worker artifact를 실행합니다. notification click은 OS 전달 이벤트와 이벤트 수명만 대신하고 실제 생성 worker의 handler를 dispatch합니다. 실제 `navigate` 이후 합성 이벤트에 OS 사용자 활성화가 없어 `focus`가 거절되는 정확한 `InvalidAccessError: Not allowed to focus a window.`만 수집하며 다른 오류는 실패합니다. data-only push는 CDP가 브라우저 PushEvent를 전달하고 실제 bundled Firebase Messaging SDK를 통과합니다. 실제 iPhone APNs 전달이나 홈 화면 설치를 했다는 뜻은 아닙니다.

## 요구사항별 결과와 남은 범위

| 요구사항 | 실행하는 테스트/확인 결과 | 이 테스트가 주장하지 않는 범위 |
|---|---|---|
| AST-001 | portfolio-journeys: 예금·부동산·대출 이름/메모/잔액 CRUD, 편집 초기값, 잘못된 생성 거절 | 모든 세부 유형의 시각적 회귀 |
| AST-002 | portfolio-journeys: 대출 음수·삭제 제외 총합; reporting: 금융자산 제외 | 모든 금액 극단값 조합 |
| AST-003 | portfolio-journeys: 실제 HTML drag 저장·새로고침, 중복 reorder 원자 거절 | 모바일 롱프레스 500ms/16px 모든 경계 |
| AST-004 | portfolio-reporting: canonical 과거 이력·기간별 baseline·유형 차트 | 캔버스 모든 날짜 포인트의 픽셀 판독 |
| AST-005 | portfolio-reporting: 과거 0원 포함 이력과 현재 자산의 다른 기간 변동액 | 일별 carry-forward 개별 포인트는 실제 정책 테스트도 유지 |
| AST-006 | portfolio-journeys/admin-portfolio: 논리 삭제 시 history 보존·일반 관리자 API 거절·관리자 복구 | 공개 경로가 없는 영구 purge 운영 승인 |
| AST-007 | portfolio-journeys: 빈 가구에 sample/demo 버튼 없음 | 운영 tenant에 실제 쓰기를 보내는 테스트는 금지 |
| AST-008 | portfolio-reporting: 실제 Scheduler의 사라진 owner/type 0원 Snapshot | 모든 legacy migration 실패 조합 |
| AST-009 | portfolio-journeys: dependent 생성·안정 profile ID 저장·명의자별 목록/합계 | 모든 archived/hidden 조합의 히스토리 필터 |
| HH-011 | portfolio-journeys: Member와 별도 dependent 명의자 생성·명의 저장·삭제 UI 부재 | 관리자 archive·Member rename 전 조합 |
| HH-012 | admin-portfolio: 마지막 Member 제거·복구, 업무 데이터 보존, 제거 token 쓰기 거절 | 타 가구 재가입 중 복구 경합 |
| HOLD-001 | portfolio-journeys: 수동 항목 UI 생성·수정·삭제 | 모든 구형 수동 저장 형식 |
| HOLD-002 | portfolio-journeys: 실제 코인 Command 수량·원가·평가 정수 반올림 | 거래소 실시간 가용성 |
| HOLD-003 | portfolio-journeys: Position 변경 후 부모 금액/원가 변경 | 모든 시세 실패 조합 |
| HOLD-004 | portfolio-journeys: stale 부모 version 거절 시 부모·Position 모두 불변 | DB commit 강제 장애는 Emulator 통합 테스트 병행 |
| HOLD-005 | portfolio-journeys: 모달 재진입 시 저장된 항목/금액 표시 | 물리 단말에서의 성능 절대값 |
| MARKET-001 | portfolio-market-catalog/provider-jobs: Storage 경계와 시장별 서버 provider 파싱 | 외부 공급자 실서비스 SLA |
| MARKET-002 | portfolio-provider-jobs: 국내·미국·펀드·KRX 금·실물 금 provider 경로와 평가 | 지원 시장 전체 상품 목록 |
| MARKET-003 | portfolio-market-catalog: 코드/별칭/미국 검색·최대10개·검색 중 callable 0회 | 실제 Upbit 검색 HTTP 경로는 별도 서버 경계 검증 필요 |
| MARKET-004 | portfolio-provider-jobs: 정상 평가 뒤 503에도 이전 잔액 보존 | Cloud Monitoring 이메일 실전송 |
| MARKET-005 | portfolio-market-catalog: 실제 gzip/checksum/metadata 읽기·기기 cache·실패 후 재검색 | Storage에 3일치 게시/정리하는 클라우드 예약 인프라 |
| MARKET-006 | portfolio-provider-jobs: Nasdaq USD와 Frankfurter 1400원 환율의 실제 곱/저장 | 모든 환율 date 역전 경합 |
| FUND-001 | portfolio-provider-jobs: C-e class539502 URL·1000좌당 NAV·미래 기준일 제외 | 실제 사업자 현재 HTML의 가용성 |
| GOLD-001 | portfolio-provider-jobs: 실물 돈 3.75g 환산과 KRX g 무환산의 다른 평가액 | 실제 단말 금 모달 폰트 렌더링 |
| GOLD-002 | portfolio-provider-jobs: 공급자 실패가 가짜 정상 금액으로 덮어쓰지 않음 | 모든 HTTP 실패 status 조합 |
| JOB-AST-001 | portfolio-provider-jobs/reporting: 실제 valuation Scheduler 전체 대상 평가·Snapshot | Cloud Scheduler가 정시에 실행시키는 GCP 인프라 |
| JOB-AST-002 | portfolio-reporting: 빈 가구/소멸 scope의 명시적0 | 모든 일간 cache 성능 상황 |
| JOB-AST-003 | portfolio-provider-jobs: 실패 후 이전 평가 보존 | legacy 모든 lifecycle 조합 |
| DIV-001 | portfolio-reporting: 실제 연간 Projection·연도 변경·원천 자산 없는 확정 배당 | 모든 배당 차트 터치 위치 |
| DIV-002 | portfolio-reporting: 실제 보유량5×주당30 예상150 표시 | 복수 공시 충돌 전 조합 |
| DIV-003 | portfolio-reporting: 실제 Scheduler fixed→paid 전이 | 공시 수집 실시간 API |
| DIV-004 | portfolio-reporting: canonical eventId map key·12개월 합계·재실행 중복 없음·짧은 legacy 월 배열 조회·일반 사용자의 직접 Projection overwrite 거절 | 장애 주입 commit 중단 |
| DIV-005 | portfolio-reporting: 기준일 양옆 snapshot 동률에서 이전날 수량7 선택·210원 확정 | history 조회 장애 복구 |
| DIV-006 | portfolio-reporting: 원천 자산 삭제 뒤에도 nonterminal 전이와 연간 보존 | 지급 전 정정·명시취소 전체 조합 |
| JOB-DIV-001 | portfolio-reporting: 실제 hourly entry의 기존 이벤트 진행·멱등 | 하루12회 GCP 발화 및 KIND 전체 paging |
| JOB-DIV-002 | portfolio-provider-jobs: 실제 Scheduler의 KRX ETF 선택·미국 ETF 제외·KIND 원문 파싱·확정 이벤트·UI | catalog 기반 legacy KRX 주식/ETF 분류는 실제 production Adapter 테스트 병행 |
| AUTO-001 | portfolio-journeys: UI 월 납입액/31일 Plan→첫 due 실행 +20000 | 모든 월의 28/29/30/31일 조합 |
| AUTO-002 | portfolio-journeys: 활성화 시 현재 잔액 그대로·서버 Plan nextDue 사용 | activation 당일/직전/직후 모든 조합 |
| AUTO-003 | portfolio-journeys: 로그인 없이 Scheduler due 월 처리·재실행 한 번·nextDue 전진 | 장기간 누락 page 경합 |
| LOAN-001 | portfolio-journeys: 원금균등100000/원리금균등90000의 다른 감소액 | 이자보다 납입액 작은 경계 |
| LOAN-002 | portfolio-journeys: 실제 대출 Plan due 실행·같은 occurrence 중복 방지 | 모든 상환법 수정·재개 조합 |
| HOME-001 | home-preferences: 기본 지출/잔여예산과 저장된 연지출/지역화폐 카드 | 수입 흐름은 finance E2E와 함께 확인 |
| HOME-002 | 지역화폐 선택은 finance/root 담당 E2E로 연결 | 본 파일은 selected-type 상세 조회를 주장하지 않음 |
| HOME-003 | home-preferences E2E: 실제 source가 없는 지역화폐는 `데이터 없음`; homeProgressiveSummary 실제 Component 테스트: 0원/NoData/실패·다른 정상 카드·partial 안내 구분 | Component 테스트는 원천 SDK 오류 전달 자체를 E2E로 주장하지 않음 |
| HOME-004 | home-preferences: 실제 서버 저장·replay·version충돌·중복 카드 거절·새로고침 | 삭제 요청에 따라 구성 UI는 없음 |
| THEME-001 | home-preferences: 다섯 테마 실제 클릭·배경5종·새로고침 복원 | OS 테마별 시각 픽셀 차이 |
| STAT-005 | portfolio-reporting: malformed 실제 자산 이력·배당 이벤트→실패 UI, 빈 성공 표시 금지 | 네트워크 종류별 timeout |
| STAT-006 | portfolio-reporting: 기간 변경 후 다른 총액 및 원천 재조회 없는 표시 | 50000문서 안전 상한 전체 |
| STAT-AST-001 | portfolio-reporting: 3M/6M/1Y/ALL와 2019년 시작점·금융토글 | 실제 단말 처리시간 |
| STAT-AST-002 | portfolio-reporting: 각 기간별 직전 baseline으로 서로 다른 변동액 | 모든 캔버스 gap 포인트 |
| STAT-AST-003 | portfolio-reporting: 현재 없는 stock scope의0원 이력 포함 | 사용자가 삭제 요청한 owner 선택 UI는 복구하지 않음 |
| ADM-001 | admin-portfolio: 실제 로그인 token·가구 목록/관리·가계부 열기 | Google OAuth consent 외부 UI 및 clipboard OS 권한 |
| ADM-002 | admin-portfolio: 일반 token 거절·Auth Emulator claim에 의한 서버 권한 승인 | 운영 IAM 부여 절차 |
| ADM-003 | admin-portfolio: 가구 논리 삭제/복구·자산 보존 | 수동 영구 purge 승인 인프라 |
| ADM-004 | admin-portfolio: 조회전용 banner·자산/통계 이동·복귀 링크 | 다른 UID의 전 금융 Query 목록은 access 보안 E2E 병행 |
| ADM-005 | admin-portfolio: 실제 dashboard callable·비용 snapshot·Cloud Logging 원시 표본 파싱/중복 제거/집계와 호출·성공·평균/P95/최대 화면 수치 | 실제 ADC/IAM·운영 로그 수집과 Billing export 인프라 |
| ADM-006 | admin-portfolio: 실제 visit callable 재전송 중복 집계 없음 | GCP 로그 보존기간 설정 |
| EXT-001 | portfolio-provider-jobs/admin-portfolio: 원시503 실패 보존·운영조회 | Monitoring 경보 이메일 전달 |
| EXT-002 | admin-portfolio: 무권한 관리자 entry 거절 | App Check attestation 외부서비스·IP별 quota 전 조합 |
| EXT-003 | portfolio-provider-jobs: 실제 SafeExternalHttpClient 경계 실행 | SSRF·redirect·timeout별 강제 거절은 기존 실제 Adapter 테스트 유지 |
| EXT-004 | admin-portfolio: 실제 저장 비용 snapshot의 누적·추정·서비스 표시 | BigQuery billing export 집계 인프라 |
| JOB-ERR-001 | portfolio-journeys/provider-jobs: job 재실행·실패를 실제 실패로 반환 | 모든 dead-letter page 복구 |
| JOB-ERR-002 | portfolio-journeys: 실제 tracked run 경계와 occurrence 중복 처리 | Scheduler 미발화 monitor·lease takeover 모든 경합 |

## PWA별 검증

| 요구사항 | 실제 검증 | 환경 한계 |
|---|---|---|
| PWA-001 | 로그인 뒤 자동 `/sw.js` 등록, manifest standalone/portrait/icon, production worker 활성화 | iPhone 설치 UI 자체는 자동화하지 않음 |
| PWA-002 | 실제 active/waiting Worker가 열린 입력·controller를 유지 | 과거 즉시활성화 artifact 자체의 이관 별도 |
| PWA-003 | root registration, 실제 bundled SDK background push, click, logout | iPhone FID/APNs 실토큰 교체는 실제 Apple 기기 필요 |
| PWA-004 | 금융/API/인증header/식별자 URL 비캐시, HTML offline 실패, 실제 logout cache폐기 | 다른 UID/가구 변경 세션 경계는 access E2E 병행 |
| PWA-005 | 생성worker의 Firebase Messaging SDK가 실제 push를 처리하고 legacy worker artifact 없음 | 빌드 환경별 프로젝트 값 drift는 production artifact 검증 병행 |
| PWA-006 | 실제 worker click handler에 Unicode/구분자 ID·traversal·dismiss, 기존 창 navigate 결과·창 1개·알림 닫기 확인 | OS 사용자 활성화가 필요한 focus/openWindow와 iOS 잠금 화면 클릭은 기기 검증 |
| PWA-007 | production CSP에서 정상 hydration 성공·임의 inline script 실제 차단·security headers·실제 로드된 Pretendard Variable 폰트·동일 origin 폰트 응답 | HTTPS 인증서/HSTS 배포 origin 실제 검증 별도 |
| PWA-008 | 실제 waiting/version handshake, legacy SKIP_WAITING/틀린버전 거절, 미저장 입력 유지·폐기승인·1회reload | 서버 UPDATE_REQUIRED의 모든 구버전 조합은 명령 경계 검증 병행 |

## 실행 및 제거 근거

- 2026-09-11 일반 브라우저/Emulator E2E 19개를 실행했고, 실패를 수정한 선택 재실행까지 모두 통과했습니다. 최종 5개 재실행은 34.6초였습니다. 이후 보강한 Projection 직접 overwrite·legacy 월 배열 확인과 Production PWA는 최종 통합 실행 결과를 따릅니다.
- 2026-09-11 21:06 KST부터 새 production Web 빌드와 기존 완성 Functions lib로 선택 6개를 실행하여 모두 통과했습니다(74.8초, 실패·건너뜀·재시도 통과 0개). 대상은 `admin-portfolio` 3개, `portfolio-market-catalog` 1개, `pwa-authenticated` 2개입니다. Cloud Logging 원시 로그 4건의 실제 파싱·집계 결과, CSP를 적용한 실제 Storage SDK 검색, 로그인 뒤 자동 worker 등록, 미저장 입력 유지/폐기 후 실제 문서 로딩 정확히 1회, 로그아웃과 재실행을 확인했습니다. 별도 변경 중인 Functions는 재빌드하지 않았으므로 이 기록은 그 시점 전체 소스의 통과를 주장하지 않습니다. JSON은 로컬 `%TEMP%/household-portfolio-admin-pwa-six-e2e.json`에 별도 보존했습니다.
- 익명 production PWA 5개는 Emulator 환경으로 생성한 기존 production artifact에서 모두 통과했습니다(16.7초, `web/quality-pwa-e2e.json`). Windows의 headless-shell은 실제 알림 권한을 제공하지 않아 정식 Chromium의 new-headless(`channel: chromium`)를 사용합니다. SDK·Notification API·실제 생성 worker handler는 교체하지 않았습니다. 일반 운영 환경 build와 로그인 PWA 2개는 별도 최종 실행 결과를 따릅니다.
- 2026-09-11 21:53 KST에는 Node **v22.23.2**, Emulator/E2E flag와 preload가 없는 새 shell에서 표준 `npm run build`로 일반 운영 Web 빌드를 생성한 뒤 `npm run test:e2e:pwa` **5개 모두 통과**했습니다(14.1초, 실패·건너뜀·재시도 통과 0개). 새 API 410 assertion을 포함하여 실제 CSP/hydration·worker cache/갱신·알림 클릭/data-only push를 검증했습니다. 빌드 ID는 `5a6b6fda-c600-41bf-9139-d51ca5e16ae3`이며 artifact의 Emulator/E2E 설정은 `false`, CSP는 demo/loopback 없이 운영 Firebase origin입니다. `%TEMP%/household-pwa-normal-production-evidence`에 결과 JSON·BUILD_ID·보안 헤더 manifest·생성 worker/workbox 및 SHA-256 manifest를 보존했습니다. 빌드·테스트 로그는 `%TEMP%/household-pwa-normal-production-{build,e2e}.log`에 있습니다. 이 실행은 Firebase DB를 사용하지 않았으며 뒤에 추가한 로그인 PWA의 정적 cache 보존 assertion 재실행은 포함하지 않습니다.
- E2E가 배당 조회의 오류 삼키기를 확인했습니다. 원래 조회 실패가 `null`/`[]`가 되어 데이터 없음으로 보였고, 없는 연도 문서의 직접 get도 Firestore Rules에서 거절됐습니다. 가구 scope의 연간 목록 조회로 부재를 판별하고 나머지 오류는 실제 실패 UI까지 전달하도록 수정했습니다.
- 이 조회 변경은 한 해 1문서 대신 가구의 연간 Projection 목록을 읽습니다. 연도 필드가 없는 legacy 문서를 유지하며 부재 연도와 권한 실패를 구분하기 위한 비용입니다. 이벤트 조회의 범위·정렬과 기존 월 배열 정규화는 변경하지 않았습니다. 관련 실제 read-model/차트/통계 세션 Jest 3파일·32개가 통과했고(11.1초), Web TypeScript 검사도 통과했습니다.
- [portfolio-shadow-audit.json](portfolio-shadow-audit.json)의 factory 34개는 운영에서 사용하지 않고 export와 테스트에서만 참조했습니다. 이를 통과시키던 테스트 37파일·전용 support 36파일을 제거했습니다. 실제 운영 handler의 등록 여부와 import graph를 검사하는 bootstrap 경계 테스트는 보존했습니다.
- Canonical ID는 실제 검증하는 happy path에만 연결했습니다. 표의 잔여 항목은 해당 ID에 연결된 시나리오의 모든 절을 E2E가 입증했다고 주장하지 않기 위해 남겼습니다. 실제 domain·HTTP parser·Firestore Adapter·Component의 실행 테스트는 유지합니다.
- 마지막 Web Jest 소스 검사 감사에서 전역 소스에 `onRegistered`/`register` 문자열이 있다는 이유로 FID 등록 동작을 주장하던 assertion 2개를 제거했습니다. deprecated `getToken` 금지 정책은 유지하고 제목을 그 범위로 좁혔습니다. 등록 흐름은 실제 `activatePwaFidEndpoint`를 실행하여 SDK callback·서버 응답·active 상태를 확인하는 `pwaFidEndpointLifecycle.contract.test.ts`가 검증합니다. Firestore import/writer 금지, 신원 adapter 제한, manifest 일치, native dialog 금지는 유효한 정적 경계로 유지했습니다. `pwaRuntimeCache`는 파일 내용을 읽은 뒤 실제 Next 설정과 cache 함수를 실행하며, 통계 테스트의 문자열 검사는 실제 DOM commit을 관찰하므로 삭제 대상이 아닙니다.
- 선택 6개 이후 읽기 감사에서 heading은 화면 진입 확인에 쓰이고 최종 성공은 DB 상태·표시 수치·실제 URL/worker 상태로 확인됨을 점검했습니다. 로그아웃 E2E는 정적 cache 보존 관측이 빠져 있어 실제 Worker install이 저장한 JS의 cache 이름·키·응답 SHA-256/길이/상태가 로그아웃 전후 동일한지 보강했습니다. 이 추가 assertion의 실행 결과는 후속 선택 재실행 기록을 따릅니다. `worker-events`의 `/api/dividend/save` 요청은 실제 410 POST이므로 정상 GET API 응답 비캐시까지 입증하지 않습니다. 정상 GET/API route 분류는 실제 `next.config.js`의 `urlPattern`을 실행하는 `pwaRuntimeCache.contract.test.ts`가 별도로 검증합니다. 합성 provider 성공 응답은 외부 경계 입력이며 실제 외부 배송 성공으로 집계하지 않습니다.
