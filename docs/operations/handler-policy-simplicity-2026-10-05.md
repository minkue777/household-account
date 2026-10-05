# 명령·조회 등록 정책 정비

## 계약과 설계

A06: 각 handler에 가구 membership 이외의 접근 정책과 receipt 소유 경계를 선언합니다. 생략하면 활성 가구원·공통 receipt를 요구합니다. 로그인 상태 조회만 `signed-in-user`/`read-only`이고, 명의 보관만 관리자 전용입니다. 실제 관리자 capability 검사는 기존 handler/domain 경계에 남습니다. 조회의 관리자 허용 여부와 외부 검색 quota도 해당 handler에 선언합니다. Router가 이름으로 별도 허용 목록을 추론하지 않습니다.

명령 실행과 예외 변환은 한 경로로 합쳤습니다. 공통 receipt가 필요한 경우에만 선행 claim과 후행 complete/abandon을 수행합니다. 서로 다른 commandId/idempotencyKey, domain 원자 receipt, payload mismatch, 재전송, 재시도 가능한 오류, 일회성 secret의 응답/receipt 분리는 유지합니다.

Firebase composition을 부작용 없이 생성할 수 있는 함수로 옮겼습니다. 서버 callable과 등록 검사가 같은 함수를 사용합니다. 공개 manifest와 닫힌 registry의 누락·추가·중복 검사는 유지하되, 가짜 handler를 이름 상수에 끼워 넣은 결과를 실제 서버 등록으로 설명하지 않습니다. manifest의 wire 목록은 독립된 호환 계약이므로 없애거나 동적으로 누락을 허용하지 않습니다. 공개 이름의 미사용 TypeScript 별칭은 제거합니다.

## 검증

- bootstrap 26개 파일 174개 통과. 이후 관리자 정책 기본 거부·principal 불일치·credential 조회 거부 3개를 추가하여 해당 router 2개 파일 18개 통과.
- quota adapter·portfolio runtime store·architecture 12개 파일 68개와 Functions test TypeScript 통과.
- 실제 command/query composition의 이름·principal 범위·관리자 허용·읽기 receipt·외부 quota 정책을 공개 계약과 비교합니다. CARD-005의 복구 명령 부재도 실제 등록 결과에서 확인합니다. 기존 상수만 검사한 중복 assertion은 제거했습니다.
- FT-01의 카드 등록 부분을 처리했습니다. 나머지 상수 관측은 각 기능 정비에서 별도 추적합니다.

## 동시 수정 CI 실패

`58c2fd1`의 CI `37259598771` Functions 실제 SDK 검사에서 포트폴리오 동시 수정 loser가 `ASSET_VERSION_MISMATCH` 대신 retryable `PORTFOLIO_UOW_FAILED`를 반환했습니다. Emulator는 잠금 timeout 뒤 RunQuery에 `Transaction is invalid or closed`를 반환했고, SDK의 transaction 재시도는 이 INVALID_ARGUMENT 문구를 재시도 대상으로 분류하지 않습니다. 오류 stack은 단일 자산의 position query입니다. 앞선 병렬 조회가 원인이라고 단정할 수 없어, 조사 중 시도한 순차 조회 변경은 철회했습니다. 제품에 SDK 오류 문자열 예외나 별도 transaction 재시도 계층을 추가하지 않습니다.

검사는 기존 공개 계약의 retryable 결과를 다룹니다. 첫 동시 요청에서 winner 정확히 한 건과 canonical 상태를 먼저 확인합니다. loser가 저장소 일시 오류이면 retryable=true·loser receipt 미생성을 확인하고 같은 명령을 한 번만 재제출합니다. 재제출 후에도 winner 상태가 같고 최종 loser는 반드시 ASSET_VERSION_MISMATCH여야 합니다. 무제한 재시도나 성공 간주를 하지 않습니다. 최종 검사 결과는 아래 기록합니다. 서버 실행 변경은 등록 정책에 해당하는 누적 Firebase 배포 대상이며 Web/APK 실행 변경은 없습니다.

최종 제품 조회 코드를 유지한 실제 Emulator 검사 3개가 통과했습니다. 로그: `TEMP/household-simplicity-portfolio-contention-final-20261005.log`. 임시 순차 조회 실험의 통과 결과를 제품 수정 근거로 사용하지 않습니다.
