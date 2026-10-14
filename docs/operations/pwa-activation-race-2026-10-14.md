# PWA 교체 경합과 갱신 중 입력 보존

## 요청과 변경 계약

서비스워커 갱신이 지연될 때 버튼이 무반응처럼 보이고, 승인 후 새로 작성한 입력도 뒤늦은 reload로 사라질 수 있는 동작을 수정한다. 요구사항은 [PWA-008·T-PWA-006](../requirements/supporting-platform/modules/pwa/requirements.md), 설계는 [worker install·activate](../requirements/supporting-platform/modules/pwa/design.md#52-worker-installactivate)에 둔다.

- 입력: 사용자가 승인한 waiting worker와 정확한 version, 현재 미저장 입력, 실제 worker 상태 전환.
- 결과: 승인한 후보에 활성화를 한 번 요청하고 진행 상태를 표시한다. 해당 후보가 실제 controller가 된 뒤 새 입력이 없으면 한 번만 reload한다. 대기 중 작성한 입력은 보존하고 새 버전 적용을 다시 승인받는다.
- 실패: 최초 입력 폐기 확인을 취소하면 아무 요청도 보내지 않는다. 메시지 전송 실패·후보 폐기(`redundant`)는 진행 상태를 해제하고 갱신 가능한 후보를 다시 확인한다. 지연만으로 실패나 성공을 선언하지 않는다.
- 저장: 새 서버·금융 데이터·영속 설정은 없다. 정상 갱신에서 cache·registration을 삭제하거나 기존 요청을 취소하지 않으며, 같은 후보에 무효한 활성화 메시지를 반복하지 않는다.

## 확인한 원인과 한계

이전 [CI 38516491867](https://github.com/minkue777/household-account/actions/runs/38516491867)과 앞선 두 실패의 공통 순서는 새로고침 직후 활성화 요청, 뒤늦은 로그인 화면의 폰트 요청, 기존 worker 중지 직후 재시작이었다. 로그인 화면·폰트 준비를 기다리지 않은 테스트가 경합을 쉽게 만들었다. 카테고리 월별 표시 변경 자체의 실패는 아니다.

실제 production artifact를 사용한 조사 결과:

| 조건 | 관측 |
|---|---|
| 실제 두 build, 같은 `/sw.js`, 화면 준비 후 경합 없음 | 약 1.1초에 교체 |
| 같은 두 build·URL, 정적 요청 경합, worker 디버거 없음 | 약 31.3초에 교체 |
| 정적 요청 경합과 Playwright worker 연결 | 45초 관측 종료까지 waiting |
| 화면·폰트 준비 후 기존 정상 검사 | 5회 통과 |

Chromium 151.0.7922.34의 소스와 관측을 대조하면 기존 worker가 종료 중 새 요청을 받아 재시작할 때 즉시 idle 종료 상태가 초기화된다. worker 디버거가 없으면 기본 약 30초 idle 뒤 복구했고, 디버거가 연결된 실행은 더 오래 대기했다. Chromium 내부 플래그를 직접 계측한 것은 아니며 운영 발생 빈도와 iPhone의 같은 경합은 확인하지 않았다. Chromium의 별도 lame-duck 상한이 5분이므로 45초 관측을 영구 정지라고 해석하지 않는다. [worker 수명 구현](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/content/browser/service_worker/service_worker_version.cc), [registration 활성화 구현](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/content/browser/service_worker/service_worker_registration.cc)

같은 후보의 `skipWaiting()` 재전송은 최초 미완료 콜백 뒤에 요청만 추가하며 활성화 준비를 재호출하지 않는다. `registration.update()`도 script가 같으면 검사만 끝낸다. 따라서 두 API를 주기적으로 호출하는 복구 로직을 추가하지 않는다. fetch 핸들러에서 우회하더라도 worker 시작은 이미 일어난 뒤다. [SkipWaiting 구현](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/content/browser/service_worker/service_worker_version.cc), [동일 script 갱신 검사](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/content/browser/service_worker/service_worker_register_job.cc)

Web API로 브라우저 내부 종료 시간을 강제 재설정할 수 없으므로 이번 변경을 Chromium 교체 지연 자체의 제거로 보고하지 않는다. 앱의 진행·입력 보존·실패 복구를 수정하고 정상 검사와 경합 검사를 분리한다.

조사 자료: `%TEMP%/household-sw-analysis-20261014/analysis.md`와 같은 폴더의 실제 A/B artifact, raw Chromium·Playwright 실행 로그 및 수명 기록. 이 조사는 운영 데이터와 배포를 변경하지 않았다.

## 검증과 추적성

| 검사 | 연결 계약 | 검증 내용 |
|---|---|---|
| `web/src/__tests__/platform/pwaRuntimeUpdate.test.tsx` | PWA-008·T-PWA-006 | 최초 확인 취소, 진행 표시·중복 클릭, 실제 후보와 다른 후보 구분, 대기 중 새 입력의 보존·적용 재승인, 전송 실패·redundant 복구, 중복 이벤트에도 reload 한 번 |
| `web/e2e-pwa/production-runtime.spec.ts` 정상 갱신 | T-PWA-INSTALL-001·T-PWA-006 | 새로고침 후 로그인 화면·폰트 준비를 확인하고 기존 15초 기준·실제 활성화·cache 검증 유지 |
| `web/e2e-pwa/raw-activation.spec.ts` | PWA-008·T-PWA-006 | 실제 production worker에 정적 요청 35개를 겹치고 worker target에 디버거를 연결하지 않는다. 실제 요청 성공, 45초 안의 정확한 후보 자연 활성화와 문서 보존을 확인하며 native 수명 전환을 첨부 |
| `web/e2e/pwa-authenticated.spec.ts` | PWA-008·T-PWA-006 | 실제 로그인·홈·카테고리 입력 후 기존 worker의 정적 HTTP 응답을 보류한다. 진행 표시·새 입력 보존·적용 취소와 재승인 후 한 번 reload를 확인 |

경합 검사의 45초는 관측된 약 31초 자연 복구를 포함하는 별도 시나리오의 기준이다. 기존 정상 활성화의 15초 기준을 늘리거나 기존 실패를 통과로 덮지 않는다. timeout에 worker를 강제로 중지·재시작하거나 요청을 취소해 검사만 통과시키지 않는다.

로컬 결과:

- HEAD 원본을 저장소 밖에 복사해 신규 단위 회귀를 연결한 수정 전 검사는 9 실패·기존 2 통과였다. 수정 후 업데이트 단위 검사 13개(두 이벤트 순서 포함)가 통과했고 캐시·worker 알림 검사 24개도 통과했다.
- `tsc --noEmit`, production build와 산출물 검증, Functions E2E 준비의 architecture 43개, 요구사항 catalog 확인이 통과했다.
- 실제 production PWA 전체 7개가 통과했다. 일반 교체·HTTP 대기·CSP·cache·push 검증을 유지했다. 별도 raw Chromium 경합에서는 기존 worker의 stopping→stopped→starting→running이 관측되고 약 32.1초 후 정확한 후보가 활성화됐다. 정적 요청 35개가 모두 HTTP 200이었고 문서를 reload하지 않았다.
- 실제 로그인·Emulator E2E 3개가 통과했다(14.6~17.4초, production build 포함). 최초 입력 폐기 취소·승인, 실제 정적 요청 보류 중 추가 입력 보호, 활성화 후 적용 취소·재승인, 정확히 한 번 reload, 로그아웃 cache·세션 경계를 확인했다. 테스트 준비에서는 worker 경로에 해당하는 쿼리 없는 공개 아이콘 하나만 cache miss로 만들었다.

로그: `%TEMP%/household-pwa-ui-regression-20261014/before.log`, `%TEMP%/household-sw-fix-{prepare,build,pwa,authenticated}-20261014.log`. raw 수명 기록은 `web/quality-pwa-e2e.json`의 `raw-worker-race` 첨부에 포함된다.

## 배포 범위와 상태

Web 실행 코드와 검사가 대상이므로 Vercel Git 자동배포로 반영한다. Firebase·APK·운영 금융 데이터 변경은 없다. 위 로컬 검증 완료 후 이 기록을 포함한 SHA를 push하고 같은 SHA의 CI·Vercel 결과를 추적한다.
