# 카테고리 지출 상세 월별 표시

## 요청과 계약

지출 통계에서 카테고리를 누를 때 선택 기간 전체 거래를 한 목록으로 보여주던 화면을 월별 합계 목록으로 바꿉니다. `STAT-004`·`T-STAT-005`의 조회·편집 계약을 유지합니다.

- 입력: 기존 통계 조회 기간과 선택 카테고리에 해당하는 최신 날짜순 거래.
- 결과: 연월 내림차순의 월별 건수·합계. 월을 누르면 해당 거래를 펼치며 다른 월은 접습니다. 거래가 없는 월은 만들지 않고, 실제 0원 거래는 남깁니다.
- 실패: 월 펼침은 이미 조회한 거래의 로컬 표시여서 새 조회나 실패 경로가 없습니다. 기존 거래 수정·삭제의 실패 복구와 가구·기간 전환 격리는 유지합니다.
- 저장: 새 저장값·API·설정은 없습니다. 거래 선택은 기존 편집 모달과 명령을 사용합니다.

## 구현과 추적성

`CategoryExpenseModal`이 회계일의 `YYYY-MM`으로 거래를 묶고 펼친 월 하나만 상태로 보관합니다. `StatsPage`의 기간·카테고리 필터와 최신 날짜 정렬을 그대로 사용합니다. 모달 상단에는 선택 카테고리의 전체 건수·합계를 유지합니다.

| 검사 | 확인할 동작 |
|---|---|
| `statisticsPage.test.tsx` | 연도 경계, 최신 월·날짜순, 월별/전체 합계, 다른 카테고리 제외, 0원 보존, 월 펼침에 추가 조회 없음, 편집·삭제·실패 초안 복구 |
| `finance-search-statistics.spec.ts` | 실제 Auth/Firestore/Functions SDK·production build에서 모바일 월별 표시, 선택 기간 경계, 빈 월 제외, 월 안의 거래 수정·삭제와 실제 저장 결과 |

## 검증 및 배포

- 관련 화면 Jest 25개 통과, `tsc --noEmit` 통과.
- 요구사항 catalog·E2E 추적성: 누락 0개.
- E2E 준비의 Functions architecture 43개 통과.
- 실제 Auth/Firestore/Functions Emulator·production build·Chromium 검사 2개가 통과했습니다(57.5초). 390×844 화면의 월별 목록을 시각 확인했고 에뮬레이터는 정상 종료했습니다.
- `34f57a8ab8b736ffee8129e4c35e67dba6d0c118`의 [Web Git 자동배포](https://vercel.com/irubias-projects/minkue777-household-account/DduBBCWWhGGfULnwroFdYjqsY1Lh)와 GitHub Production deployment `7057608823`이 성공했습니다. 운영 `/stats`·`/sw.js`의 HTTP 200 및 해당 SHA, 해당 SHA의 `_buildManifest.js` HTTP 200을 확인했습니다. 이 변경 자체는 Firebase·APK 배포 대상이 아닙니다.
- 앞선 토스 캐시백 변경 `db131ee661574c903e0a6f54381b7b2ba50bf48d`의 서버 배포는 별도이며 [작업 기록](toss-ignore-cashback-2026-10-14.md)으로 추적합니다.

로컬 로그: `%TEMP%/household-category-month-{unit,types,prepare,e2e}-20261014.log`.

## CI PWA 활성화 실패 조사

[CI 38516491867](https://github.com/minkue777/household-account/actions/runs/38516491867)의 Web Jest 131개 파일·1,037개 검사와 production build는 통과했습니다. PWA 검사에서는 5개가 통과하고 기존 `production-runtime.spec.ts`의 `T-PWA-INSTALL-001`이 실패했습니다. 새 worker가 설치된 뒤 15초 안에 활성화되지 않아 기존 worker가 controller로 남았습니다. 카테고리 월별 표시에 대한 실패는 아닙니다.

- trace에서 후보 worker가 올바른 build ID의 활성화 메시지를 받고 `skipWaiting()`을 호출한 사실을 확인했습니다. 이 Promise는 검사 종료까지 해결되지 않았고 후보는 `installed` 상태였습니다.
- 호출 전 기존 worker의 관측된 `waitUntil` 대기는 없었습니다. 외부 CDP 기록에서는 기존 worker가 중지 직후 다시 실행됐고 후보의 `activating` 전환과 worker 오류 이벤트는 없었습니다. 기존 worker가 다시 실행된 원인이나 브라우저 내부 활성화 중단 원인은 이 기록만으로 확정할 수 없습니다.
- 같은 production build·Chromium 검사를 변경 없이 로컬에서 3회 실행해 모두 통과했습니다(각 약 3.7초, 전체 15.9초). 15초 기준과 기존 UI·캐시·활성화 검증은 유지했습니다. 제품 버그를 수정했거나 간헐 실패의 원인을 해결한 것으로 보고하지 않습니다.
- [앞선 PWA 관측 기록](ios-notification-startup-2026-10-12.md)과 함께 실패 이력을 보존하고, 사용자 요청인 배포 인증 스킬 변경의 새 SHA에서 전체 CI 결과를 후속 확인합니다. 실패 실행 자체를 재실행해 덮지 않습니다.

실패 artifact: `%TEMP%/household-category-month-ci-38516491867`. 로컬 로그: `%TEMP%/household-category-pwa-{build,repro}-20261014.log`.
