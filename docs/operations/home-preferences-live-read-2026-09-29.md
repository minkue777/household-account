# 홈 설정 실시간 반영 실패 관측 — 2026-09-29

## 확인된 실패와 범위

SHA `1cef6a79c4ed05b2faf039125c607351c54787a0`의 [CI 36448234017](https://github.com/minkue777/household-account/actions/runs/36448234017)에서 Web E2E 98개 중 기존 홈 설정 검사 1개가 실패했습니다. `home-preferences.spec.ts`는 설정 Command 이후 첫 카드가 `년 지출`로 바뀌어야 한다고 검증하지만 30초 동안 `9월 지출0`을 유지했습니다. 다른 카드도 월 잔여 예산 기본 구성을 유지했습니다.

이번 분석은 테스트 관측 보강입니다. 제품 원인을 확정하거나 실시간 구독 코드를 수정한 작업이 아니며 운영 데이터를 변경하지 않았습니다. 같은 증상의 [2026-09-23 CI 35826417801 관측](quick-edit-tags-2026-09-23.md#ci-후속-관측--2026-09-23)과 원래 실패 이력은 유지합니다. 이후 별도 실행의 성공이 원래 실패를 없애거나 원인 해결을 증명하지는 않습니다.

## 저장·전송·화면의 증거

| 경계 | 확인 결과 |
|---|---|
| 실제 설정 Command | `home.update-summary-preferences.v1`의 HTTP 200, `succeeded` 응답을 확인했습니다. 재전송 결과인 `already-processed`가 아닙니다. |
| 서버 저장 | Command 직후 실제 Firestore Emulator REST 조회가 `homePreferences/home`의 `left=YEARLY_EXPENSE`, `right=LOCAL_CURRENCY_BALANCE`, `aggregateVersion=1`을 반환했습니다. 문서 생성·갱신 시각은 `2026-09-28T16:09:30.466093Z`입니다. 저장 검증은 통과했고 그 다음 UI 검증에서 실패했습니다. |
| 구독 대상 | `16:09:30.197Z`의 실제 Listen 요청이 같은 가구의 `homePreferences/home`을 target `1002`로 등록했습니다. 해당 wire target의 해제·재등록은 없었습니다. |
| 전송 수명 | 열린 Listen GET은 HTTP 200이며 응답이 끝나지 않아 기존 trace에 본문이 남지 않았습니다. 뒤 POST의 AID가 `19 → 20 → 25 → 28 → 29`로 증가했습니다. 09/23 실패와 같은 흐름이며 미완료 GET만으로 전체 전송 정지를 단정할 수 없습니다. |
| 브라우저 | trace에 console/page error가 없고, 실패 대기 중 인증 복구 Command·페이지 재탐색도 없었습니다. 약 10초 뒤 등록된 Service Worker는 새 버전 안내만 표시했습니다. 최종 screenshot과 진단 첨부 모두 기본 카드 두 개를 확인했습니다. |

서버 저장 실패와 다른 가구 구독은 배제했습니다. 기존 첨부만으로 해당 문서의 `documentChange`가 브라우저에 전달됐는지, SDK가 홈 설정 callback을 호출했는지는 확인할 수 없습니다. 지역화폐 조회도 같은 문서를 구독하므로 wire target이 유지됐다는 사실만으로 React 훅의 cleanup·재구독 부재까지 단정하지 않습니다.

원본 artifact는 `%TEMP%/household-asset-zero-rows-ci-36448234017`, 해제한 trace는 `%TEMP%/household-home-preferences-trace-36448234017`, 실패 로그는 `%TEMP%/household-asset-zero-rows-ci-36448234017.log`에 보존했습니다.

## 추가한 관측과 검증 경계

[실제 홈 설정 E2E](../../web/e2e/home-preferences.spec.ts)에 [Listen 응답 관측 helper](../../web/e2e/firestore-listen-observation.ts)를 연결했습니다. [홈 환경설정 요구사항](../requirements/supporting-platform/modules/home-preferences/requirements.md)의 `HOME-001`·`HOME-004` / `T-HOME-002`에 해당하는 저장 구성의 실시간 표시 경계를 관찰합니다. 기존 `HOME-003` / `T-HOME-003`의 선택 자료 없음 표시와 Command 재전송·version 충돌·중복 카드 거절·새로고침 검증도 유지합니다. 새 업무 요구사항이나 사용자 화면은 추가하지 않습니다.

- 실제 `fetch` 응답의 clone stream 또는 `XMLHttpRequest`의 progress/readystatechange에서 완료 전 chunk를 읽습니다. SDK에 전달하는 원본 응답·요청·헤더·본문은 변경하지 않습니다.
- 길이 접두사가 있는 실제 WebChannel frame을 해석하고, 테스트 프로젝트의 `homePreferences/home` 문서 변경에 대해서만 가구 식별자·허용 카드 enum·정수 version·target ID를 기록합니다. target 변경도 유형·숫자 ID·숫자 오류 코드만 기록합니다. 요청 본문·인증값·원문 알림·resume token·다른 문서 필드는 첨부하지 않습니다.
- 기록은 2,000개, 누적 관찰 문자열은 4,000,000자, 미완성 frame 버퍼는 256,000자로 제한합니다. 초과·파싱 오류를 성공으로 숨기지 않습니다. 정리 시 wrapper와 이벤트 listener를 복구·해제하고 clone reader를 취소합니다. 페이지를 떠날 때도 정리합니다.
- 기존 UI assertion과 30초 제한을 그대로 둡니다. 성공 경로에서도 해당 가구의 실제 `documentChange`가 저장한 카드·version과 일치하는지 확인하고 `parseErrors=0`, `truncated=false`를 검증합니다. 성공은 `home-preferences-listen-responses`, 실패는 기존 `home-preferences-live-read` 첨부에 허용된 관측값을 남깁니다.

응답 clone에서 문서 변경을 확인해도 제품 SDK의 callback 실행이나 React 상태 적용 자체를 증명하지는 않습니다. 다음 실패에서 전송 이전·이후 경계를 더 좁히기 위한 진단이며, 결과를 확인하지 않고 제품 결함 또는 Emulator 결함으로 분류하지 않습니다.

## 국소 검증과 배포

- `web` 디렉터리의 `npx tsc --noEmit --pretty false`가 통과했습니다.
- 별도 Chromium 검사에서 로컬 임시 HTTP 서버가 두 WebChannel frame을 분할 전송하고 응답을 열린 채 유지했습니다. 종료 전 두 frame 관측, 비허용 필드 제외, 원본 응답 바이트 불변, 정리 후 기록 중단을 확인했습니다. 이 검사는 PowerShell here-string을 `node`에 전달해 실행했으며 별도 파일 로그는 남기지 않았습니다. 출력은 `observedBeforeResponseEnd=true`, `frames=2`, `redaction=passed`, `originalResponse=unchanged`, `cleanup=passed`였습니다. 실제 Firebase 경계의 검증 결과를 대신하지 않습니다.

- 실제 Firebase Emulator·production Web build·Chromium에서 해당 홈 설정 검사를 5회 실행해 모두 통과했습니다(45.2초). 각 실행에서 20개 frame을 파싱했고 저장된 카드 구성·version 1의 `documentChange`를 확인했습니다. 파싱 오류와 관측 잘림은 모두 0이었습니다. 30초 UI assertion·재전송·version 충돌·중복 카드 거절·새로고침 검증을 유지했습니다. 실패는 재현되지 않았으므로 원인을 해결했다는 근거가 아닙니다.
- E2E 준비의 Functions architecture 45개와 세 codebase 준비가 통과했습니다. 실행 후 웹 서버와 Firebase 에뮬레이터가 종료됐음을 확인했습니다. 로그는 `TEMP/household-home-listen-prepare-20260929.log`, `TEMP/household-home-listen-e2e-20260929.log`입니다.

이번 관측 보강은 테스트·문서만 변경하므로 Firebase·Web 실행 파일·APK의 새 배포 대상이 아닙니다. 앞선 자산 기능 변경 `1cef6a7`은 Vercel Git 배포와 운영 반영이 성공했으나 CI는 위 실패로 미완료입니다. 후속 후보의 전체 CI를 확인하되 원래 실패 run을 무변경 재실행하지 않습니다.
