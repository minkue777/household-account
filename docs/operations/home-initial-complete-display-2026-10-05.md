# 첫 홈 전체 준비 후 표시 복원

## 요청과 계약

2026-10-05 사용자는 첫 홈의 지역화폐 잔액·잔여 예산·날짜별 소비금액이 응답 순서대로 나타나는 대신 모두 준비된 뒤 함께 보이도록 요청했습니다. 2026-07-28 `9931f533`의 점진 표시 정책을 이 요청으로 변경합니다. 조회 최적화와 표시 시점은 구분합니다.

- [LED-001](../requirements/contexts/household-finance/modules/ledger/requirements.md): 첫 월 원장·카테고리·지역화폐의 정상 서버 결과를 모두 기다립니다.
- [홈 설정 계약](../requirements/supporting-platform/modules/home-preferences/requirements.md): 저장된 카드 설정을 확인하며 연간 합계가 필요한 구성은 해당 결과까지 기다립니다.
- 빈 원장·0원·지역화폐 NoData·설정 문서 없음은 정상 결과입니다. 첫 조회 오류는 재시도를 제공하며 무한 로딩으로 감추지 않습니다.
- 첫 표시 후 같은 가구의 월 전환·실시간 갱신은 화면 전체를 숨기지 않습니다. 가구 전환·인증 해제는 표시 완료 상태를 폐기합니다.

## 구현

`LedgerPage`가 첫 표시 조건과 이미 표시한 가구 ID를 소유합니다. 월 원장·카테고리·지역화폐·홈 설정을 병렬로 받는 경로는 그대로이고, 연간 구독은 기존처럼 월 원장 수신 뒤 시작합니다. 추가 네트워크 요청이나 고정 대기 시간은 없습니다. 데이터가 준비되기 전에는 문구 없이 빈 화면과 `aria-busy` 상태만 유지하고, 실패하면 오류·다시 시도, 모두 준비되면 기존 헤더·카드·달력을 반환합니다. 같은 날 후속 요청으로 “가계부를 불러오는 중입니다.” 문구를 제거했으며 전체 준비 대기 조건은 그대로입니다.

`useHomePreferences.ready`는 기본 카드 설정과 실제 서버 응답을 구별합니다. 문서 없음도 서버가 확인한 정상 결과입니다. `useLedgerHomeReadiness`의 원장·전체 홈 paint는 화면이 실제 표시된 경우에만 두 프레임 뒤 기록합니다. 데이터 원천별 준비 계측과 첫 paint 이후 사전 조회는 유지합니다.

## 검증과 추적성

| 경계 | 검사 |
|---|---|
| 원장·카테고리·지역화폐·홈 설정·연간 합계의 마지막 결과 대기, 0원·빈 결과, 최초 실패·재시도 | `homeFirstCompletePaint.contract.test.tsx` |
| 같은 가구 갱신의 DOM 유지, 가구 왕복 전환 시 초기 대기 | `homeFirstCompletePaint.contract.test.tsx` |
| 미표시 화면의 paint 금지와 기존 사전 조회 | `useLedgerHomeReadiness.contract.test.tsx` |
| 설정 문서 미수신·cache·오류·정상 없음·가구 전환 | `homePreferencesRead.contract.test.tsx` |
| 카드 자체의 미준비·실패·NoData·금액 표시, 기존 편집 초안 보존 | `homeProgressiveSummary.contract.test.tsx`, `ledgerEditDraftPersistence.contract.test.tsx`, `ledgerPageLifecycles.contract.test.tsx` |
| 실제 Auth/Firestore/Functions Emulator·Lite·Listen·WebKit에서 마지막 잔액 응답 보류 후 예산·잔액·달력 동시 표시와 live 갱신 | `ios-startup.spec.ts`의 `T-LED-001`·`T-HOME-003`·`T-WEBVIEW-004` |

로컬 검증 결과:

- 관련 Jest 6개 파일 39개 통과, `tsc --noEmit` 통과.
- 실제 Emulator와 production Web build를 사용하는 `ios-startup.spec.ts`의 WebKit 4개 통과(54.3초). 첫 표시 대기 외에 재실행·날짜별 내역·추가·검색·편집·Lite→Listen 변경/삭제 전달을 포함합니다.
- 잔액 갱신을 정확한 `0`으로 확인하도록 assertion을 보강한 뒤 해당 E2E 1개 통과(31.7초). 실제 잔여 예산 87,700원·잔액 36,890원·날짜 소비 12,300원 표시와 이후 0원 반영, 달력 DOM 유지까지 확인했습니다.
- 요구사항 catalog 검사·E2E 추적성 생성 통과, 문서 링크·테스트 추적성 13개 통과. 추적 대상 248개 중 E2E 244개, 외부/퇴역 4개, 누락 0개입니다.
- 로그: `TEMP/household-home-complete-{unit,types,docs,e2e,zero-e2e}-20261005.log`.

실제 서버 응답을 변경하지 않고 전달만 보류했으며 운영 데이터는 변경하지 않았습니다. 로컬 에뮬레이터는 정상 종료했습니다.

후속 로딩 문구 제거는 기존 테스트의 대기 상태 기대값을 빈 본문·`aria-busy=true`로 변경했습니다. 관련 Jest 14개와 실제 Emulator·production build·WebKit E2E 1개(31.7초)가 통과했습니다. 로그는 `TEMP/household-home-loading-text-{unit,e2e}-20261005.log`입니다.

## 배포 범위

Web 실행 코드 변경으로 Vercel Git 자동배포 대상입니다. Firebase·Android 실행 코드는 변경하지 않아 Functions 재배포와 APK 발행은 필요하지 않습니다. Android WebView도 배포된 같은 Web 표시 정책을 사용합니다.

이전 가맹점 규칙 변경 `1131f723`의 CI `37316256663`은 다섯 검사와 `CI 결과 요약` 모두 성공했습니다. 이전 실행의 Auth Emulator socket hang up 이력은 해당 [작업 기록](settings-mobile-actions-2026-10-05.md)에 유지합니다.
