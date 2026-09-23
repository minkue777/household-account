# iPhone 첫 홈 표시 시간 관측 보강

## 요구사항·설계·호환성

사용자는 최근 iPhone 첫 화면 지연의 실제 구간을 구분하고 그 사이 변경의 영향을
확인할 수 있도록 운영 데이터를 보강하도록 요청했습니다. `ADM-006` / `T-ADM-005`를
확장하며 화면 준비 조건과 기존 총시간 수치는 유지합니다.

| 관측 | 의미 |
|---|---|
| Navigation 응답 시작/완료·DOM interactive·bootstrap 시작 | 문서 수신과 앱 코드 시작 전 대기 구분; JS 다운로드/파싱만의 시간이라고 단정하지 않음 |
| Auth·Membership·가구 metadata 시작/완료 | 인증 복원과 가구 진입 경로; 실제 사용한 캐시·prefetch만 별도 표시 |
| 원장·카테고리·지역화폐·필요 연간 합계 준비 | 홈에서 각 최신 데이터가 준비된 최초 관측; 연간 합계 필요 여부 포함 |
| homeReady·firstLedgerPaint·firstHomeCompletePaint | 데이터 준비 이후 paint까지 대기; 모든 값은 navigation 기준 offset |
| initialVisibility·tracking 시작 offset·hiddenMs·hiddenCount | bootstrap 이후 관측된 백그라운드 경과; 관측 이전 구간은 미확정으로 유지 |
| webBuild·navigationType·Service Worker 제어 여부 | 실제 실행 Web 빌드·재탐색·워커 환경별 비교; Functions revision과 구분 |

기존 `access.record-app-visit.v1`에 선택적 `clientStartupDiagnostics` version 1을
싣고 같은 `clientStartup` total 로그에 저장합니다. 추가 네트워크 요청이나 Firestore
진단 문서를 만들지 않습니다. 로그 시각은 방문 기록 수신 시각이며 클라이언트 실행 시각과
동일하지 않습니다. URL·UA 원문·이름·가구·거래·금액은 진단에 포함하지 않습니다.

서버는 허용된 키/enum/0~전체 시간 범위의 유한한 숫자만 재구성합니다. 손상된 진단은
그 부분만 생략하고 유효한 접속과 총시간을 보존합니다. 구버전 요청과 Android 시작 표본,
일반 Web 접속, 기존 `clientStartupTimingsMs` 무시 정책을 유지합니다. 서버의 필드 수용을
먼저 운영 배포한 뒤 Web push/자동배포를 진행합니다. Android APK 변경은 없습니다.

모든 구간은 병렬 실행될 수 있으므로 합산하지 않습니다. 기존 성공·2분 이내·문서당 1회
측정 기준은 유지하고 백그라운드 시간을 임의 차감하지 않습니다. 과거 18초를 소급해서
분해하거나 이번 관측 보강을 속도 개선으로 주장하지 않습니다.

## 검증 추적성

| 계약 | 실제 검사 |
|---|---|
| 허용 필드·범위·누락 관측·비민감 데이터 | `functions/test/observability/client-startup-diagnostics.test.ts` |
| 동일 로그 저장·재전송 멱등·손상 무간섭·구버전 | `functions/test/bootstrap/member-access-app-visit-latency.test.ts` |
| visibility 전환·readiness 도착 순서·navigation 미지원·플랫폼 분리 | `web/src/__tests__/platform/clientStartupDiagnostics.contract.test.ts` 및 기존 startup 계약 검사 |
| 실제 iPhone WebKit/SDK/Emulator 재실행·서버 수락·문서당 한 번·빌드 일치 | `web/e2e/ios-startup.spec.ts` |

로컬 검증 결과:

- 서버 집중 검사 3파일 43개와 Functions 타입 검사가 통과했습니다. 실제 logger까지
  연결한 검사는 동일 visit 재전송에서 단계가 들어 있는 total 로그가 하나임을 확인합니다.
- Web 관련 Jest 6파일 27개와 `tsc --noEmit`이 통과했습니다.
- E2E 준비의 architecture 45개와 실제 production Web build를 통과했습니다.
- 실제 Firebase Emulator와 iPhone WebKit의 재실행 E2E 1개가 통과했습니다(전체 50.5초).
  새 문서마다 실제 요청이 한 번 전달되고 서버가 수락하며 최신 원장·잔액과 로그인 유지,
  Navigation Timing·빌드·캐시·단계 대응을 확인했습니다. 실제 Functions stdout의
  `clientStartup` 두 로그에도 해당 문서의 진단이 보존됨을 확인했습니다.
- 로그는 저장소 밖 `TEMP/household-ios-diagnostics-{prepare,e2e}-20260923.log`에 있습니다.
  이 WebKit 결과는 개발 PC의 Emulator 관측이며 운영 iPhone 속도 개선 증거가 아닙니다.

배포 대상은 Functions 세 codebase의 공유 소스와 Web입니다. 서버를 먼저 배포하고
그 뒤 해당 commit을 push해 Vercel Git 자동배포와 전체 CI를 시작합니다.

Functions 구현 후보 `661ca903371c161522ad953265d4f4b81a43381c`는 운영 세 codebase의
17개 함수 배포와 실제 로그인·가구 Query의 release/commit/artifact marker 검증을
완료했습니다. Release ID는 `release-20260923-ios-startup-diagnostics-661ca90`, 로그는
`TEMP/household-ios-diagnostics-deploy-20260923.log`입니다. 후속 문서 커밋에는 실행 코드
변경이 없으며 Web과 CI는 main push의 최종 SHA로 확인합니다.

## 변경 이력 조사

조사 범위는 2026-09-16~23의 Web 초기 실행 경로, 공유 모듈, 원장·카테고리 읽기,
홈 완료 조건과 GitHub Production deployment입니다. 아래 시각은 한국 시간이며
commit 시각과 실제 배포 성공 시각을 구분했습니다. 기존 운영 표본에는 Web revision,
단계별 시간, 숨김 상태가 없어 특정 표본과 실제 실행 중인 PWA 버전을 확정할 수 없습니다.

| 변경 | 확인된 실행 경로와 영향 가능성 | 한계·반대 근거 |
|---|---|---|
| `744ecc5` 저장 원본 통합, 9/18 18:58 commit; 이를 포함한 `974967d` Production 배포 9/18 19:16:07 성공 | 홈 월/연 조회가 `expenses`의 `date` 범위에서 가구별 `ledgerTransactions`의 `accountingDate` 범위로 바뀌었습니다. 카테고리는 목록 query에서 `categoryCatalog/current` 한 문서 구독으로 바뀌었습니다. 첫 서버 snapshot을 기다리는 실제 경로가 바뀌므로 우선 관측 후보입니다. canonical에만 보존되던 삭제·대체 감사 문서도 날짜 query가 받아온 뒤 화면에서 제외합니다. | 서버 snapshot 우선 정책은 이전에도 있었고 새 직렬 대기나 타이머를 추가하지 않았습니다. 통합 문서의 108개 감사 문서는 운영 전체 수치이며 해당 가구/월 증가량이 아닙니다. 인덱스·Rules 배포와 데이터 대조는 성공했습니다. 조회 경로 변경만으로 수초 지연을 확정할 수 없습니다. |
| `8fa3d33` 태그 기능, 9/18 22:00 commit; Production 배포 22:07:18 성공 | `LedgerPage`가 월·연 원장을 합쳐 태그 추천 목록을 만들고 각 거래 mapping에서 태그를 정규화합니다. 모달을 열기 전에도 이 계산은 실행되며 태그 입력 컴포넌트는 기존 정적 import 경로에 포함됩니다. 초기 CPU·공유 코드량에 영향을 줄 가능성은 있습니다. | 새 네트워크 조회·추가 서버 snapshot 대기·신규 패키지를 도입하지 않았습니다. 기존 원장 배열의 순회만으로 5~18초를 설명할 실측 근거는 없습니다. 이후 `abb9b39`/`ba04eab`는 태그 표시 스타일, `10be8f3`는 입력 문구 변경입니다. |
| `c831984` 홈 lifecycle hook 추출, 9/17 01:02 commit | `useLedgerHomeReadiness`와 `useLedgerYearSummary`로 기존 코드를 옮겼습니다. 월 원장 뒤 연간 합계 구독, 월 원장·카테고리·지역화폐·필요 연간 합계 완료 후 두 animation frame을 기다리는 종료 조건을 전후 diff로 대조했습니다. | 준비 조건을 새로 강화한 변경은 아닙니다. 이 변경 이후인 9/17~18에도 빠른 표본이 있어 9/19 이후 증가의 직접 근거가 약합니다. |
| `8ad38fc` 자산 명의·종목 검색, 9/21 20:17 commit; Production 배포 20:18:43 성공 | 자산 화면과 종목 검색 경로를 변경했습니다. 자산 화면 prefetch는 기존대로 홈 전체 표시 이후에 예약됩니다(15초 fallback 유지). | 9/19·20 및 9/21 09:49의 느린 표본보다 늦게 배포됐으므로 최근 전체 증가의 시작 원인이 될 수 없습니다. 홈 기본 조회나 초기 Auth를 바꾸지 않았습니다. |
| `ea9575d` 수정·삭제 즉시 화면 반영, 9/22 11:56 commit; Production 배포 11:57:38 성공 | `ExpenseEditModal`의 저장·삭제 중 표시 상태만 변경했습니다. 모달은 홈 정적 import 경로에 있지만 새 대규모 의존성은 없습니다. | 9/22 09:32의 18.142초 표본보다 늦게 배포됐습니다. 첫 홈 데이터 구독·준비 조건을 수정하지 않았으므로 해당 18초 표본의 원인으로 볼 수 없습니다. |

인증 초기화, `AppProviders`, `CategoryContext`, `LedgerReadModelContext`,
`webStartupPerformance`, `clientStartupObservation`, `PwaRuntimeUpdate`, Web 의존성은
이 기간에 시작 동작을 바꾸는 수정이 없었습니다. `HouseholdContext`의 9/17 변경은
mapper 추출과 이름 변경 후 최신 가구 상태 보존이며 초기 조회 순서 변경은 아니었습니다.
서비스 워커/캐시 갱신 로직이 새로 바뀌었다는 근거도 없습니다. 다만 새 배포의 정적 파일
재수신, 네트워크/인증 복원, 화면이 숨겨진 동안의 경과 시간은 기존 총시간만으로 분리할 수 없습니다.

첫 원장 표시 후 3초에 명령 runtime을 미리 불러오는 기존 경로와 15초 이후의 다른 화면
prefetch fallback은 여전히 존재합니다. 따라서 전체 홈이 늦을 때 부가 작업과 경합할
가능성은 있지만 이번 기간에 새로 도입된 동작은 아닙니다. 18초가 이 15초 fallback 때문에
발생했다고 판단할 증거도 없습니다.

### 읽기 전용 규모 확인

2026-09-23 22:28 KST에 또니망고네의 운영 원장을 Firestore aggregate `count()`로
확인했습니다. 상태·기간 복합 count는 기존 인덱스가 없어 `FAILED_PRECONDITION(9)`으로
조회하지 못했으며 인덱스나 운영 문서를 변경하지 않았습니다.

| 대상 | 현재 확인값 | 해석 범위 |
|---|---:|---|
| 2026년 9월 canonical 날짜 범위 전체 | 182문서 | 초기 월 query가 받을 수 있는 수; 삭제·대체 문서 포함 |
| 2026년 canonical 날짜 범위 전체 | 1,932문서 | 연간 카드가 표시될 때 받는 범위; 활성 거래 수와 다름 |
| 현재 구형 `expenses`의 같은 가구 9월 | 0문서 | 9/18 승인된 원본 정리 이후의 결과이며 당시 데이터가 없었다는 뜻은 아님 |
| `categoryCatalog/current` | 12개 항목, JSON UTF-8 2,539바이트 | Firestore wire 압축 크기는 아님; 카테고리 문서가 비대해졌다는 근거는 약함 |
| 9/18 보존 백업의 동일 가구 구형 원장 | 9월 129문서, 연간 1,781문서 | 현재보다 각각 53/151개 적지만 기간 사이 실제 신규·수정·분할·삭제가 섞여 통합으로 늘어난 양이라고 확정할 수 없음 |

운영 조회 결과는 저장소 밖 `TEMP/household-ios-startup-counts-20260923.json`에 기록했습니다.
백업은 `TEMP/household-storage-originals-backup-20260918.json`을 로컬 집계만 했으며 복원하지 않았습니다.
문서 내용·이름·금액을 출력하거나 새로 저장하지 않았습니다.

22:36 KST에는 복합 인덱스 추가 없이 실제 UI와 같은 `householdId`·날짜 범위 query에
`select(lifecycleState, deletedAt)`만 적용해 상태를 집계했습니다. 식별자·날짜·금액·메모는
출력하거나 저장하지 않았으며 결과는 `TEMP/household-ios-startup-projected-counts-20260923.json`입니다.

| 범위 | 전체 수신 | 표시 대상 | 삭제 | 대체 | 화면에서 제외 |
|---|---:|---:|---:|---:|---:|
| 9월 | 182 | 158 | 13 | 11 | 24 (13.2%) |
| 2026년 | 1,932 | 1,714 | 91 | 127 | 218 (11.3%) |

`deletedAt`이 있는 월 9건·연 22건은 모두 위 제외 상태와 겹쳤습니다. 추가 수신문서가
있다는 점은 확인됐지만 이 양이 수초 지연을 유발하는지는 단계 기록으로 확인해야 합니다.

최근 기간에도 9/19 20:39의 1.698초, 9/20 08:58의 1.483초,
9/21 01:09의 1.407초처럼 빠른 표본이 섞여 있습니다. 따라서 증가를 모든 실행에 고정으로
추가된 지연이라고 보기는 어렵습니다. 실제 실행 revision과 단계별 관측을 붙여
원장 수신·카테고리 수신·인증/회원 복원·paint·숨김 경과 중 어느 구간이 늘었는지 비교해야 합니다.

조사 근거:

- `web/src/lib/expenseService.ts`: 월/연 범위 query 및 첫 서버 snapshot 처리.
- `web/src/features/ledger/application/ledgerReadVisibility.ts`: 수신 뒤 삭제·대체 문서 제외.
- `web/src/lib/categoryService.ts`: canonical 단일 문서 구독과 카테고리 검증.
- `web/src/components/home/LedgerPage.tsx`: 정적 import와 태그 추천 계산.
- `web/src/features/ledger/useLedgerHomeReadiness.ts`, `useLedgerYearSummary.ts`: 기존 준비 조건/연간 순차 구독.
- `web/src/components/AppProviders.tsx`: 첫 화면 뒤 prefetch·telemetry·명령 runtime 준비.
- `docs/operations/storage-consolidation-2026-09-18.md`: 운영 대조, canonical 감사 이력 108개 및 배포 결과.
- GitHub Production deployment `6522209962`, `6524903884`, `6537264286`, `6567184148`, `6582418961`의 `success` 상태/시각.
