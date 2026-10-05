# 과거 성능 보고서 fixture 계약 정비

기준 SHA는 `921ef881ccd84641aa711416cde7f31bfddbfabb`입니다. 저장된 과거 기준·판정을 현재 정책으로 재평가하지 않고 HTML에 표시하는 계약을 검토했습니다. 제품 실행 코드는 유지하고, 전용 테스트 fixture의 중복 원본 표본 배열만 제거했습니다.

## 읽은 범위와 실제 소비자

다음 세 파일은 전체 본문을 읽었습니다.

| 파일 | 역할과 확인 범위 |
|---|---|
| [historical-gate-report.json](../../../tools/performance/fixtures/historical-gate-report.json) | 저장된 gate 결과, CI/UX 기준·판정, 본표본 통계와 준비 실행을 담는 고정 테스트 자료 |
| [html-report.test.mjs](../../../tools/performance/html-report.test.mjs) | fixture의 유일한 직접 소비자와 전체 13개 renderer/CLI 검사 |
| [html-report.mjs](../../../tools/performance/html-report.mjs) | 결과·통계 읽기, HTML 생성, 오프라인 조작 코드, CLI 입력·출력 및 원본 덮어쓰기 거부 |

저장소 검색에서 fixture 경로를 직접 읽는 코드는 위 테스트 한 곳입니다. 계약 근거는 [HTML 보고서 안내](../../operations/performance-html-report.md)의 과거 판정·기준 보존, [보고 전용 정책](../../operations/performance-report-only-2026-09-17.md)의 과거 실행 보존, [기존 검사 정비 기록](../../operations/verification-simplicity-2026-10-05.md)의 고정 gate fixture 도입 목적을 확인했습니다. 현재 정책 파일 `budgets.mjs`의 앞부분도 참고했지만 해당 파일 전체를 이번에 읽었다고 집계하지 않습니다.

## 입력·결과·실패·저장 계약

- 입력은 과거 실행 당시 기준과 판정이 이미 저장된 JSON입니다. 현재 판정기로 fixture를 다시 만들거나 과거 `gate`를 현재 `report-only`로 바꾸지 않습니다.
- 결과는 저장된 실행 `passed`, CI `pass`, UX `fail` 및 각각의 중앙값·반복·최대 기준을 표시하는 독립 HTML입니다. 반복 그래프는 저장된 필요 횟수와 본표본 배열로 표시값만 구하며 판정을 새로 계산하지 않습니다.
- 실패는 기존 renderer/CLI가 소유합니다. 판정 결과가 없는 입력, 불완전 측정, 기능 실행 오류와 원본 덮어쓰기 거부를 기존 테스트 그대로 확인합니다.
- 저장 경계는 입력 JSON 불변과 별도 HTML 출력입니다. 이 변경은 합성 테스트 fixture에만 적용하며 과거 CI 원본이나 운영 측정 자료의 표본을 삭제하지 않습니다.

## 변경과 유지 이유

fixture 최상위 `samples`는 준비 실행 1개와 본표본 7개를 객체로 반복 보관하고 있었지만 renderer는 이 배열을 읽지 않습니다. 화면의 본표본은 `performance.statistics[].samplesMs`, 준비 실행은 `performance.warmupSamples`가 소유하므로 최상위 배열만 제거했습니다. 두 표시 원천, 7회 본표본, 10,000ms 준비 실행, 당시 기준·판정·실패 이유는 그대로 남겼습니다.

실행 시각·커밋·정책 버전·기준 metadata와 저장된 결과 구조를 압축하거나 현재 판정기 호출로 대체하지 않았습니다. 이 fixture를 수학적으로 가장 짧은 JSON으로 만드는 것은 목표가 아닙니다. 저장된 과거 형식을 고정해 두는 이점이 있으며, 확인된 중복만 제거하는 쪽이 계약을 더 직접적으로 표현합니다.

직접 소비 테스트의 기존 기대값은 모두 유지했습니다. 같은 과거 fixture 검사에 CI/UX 반복·최대 기준, 반복·최대 측정값, 본표본 7개 표시 및 준비 실행 분리 확인을 추가했습니다. renderer 자체는 변경하지 않았습니다.

## 전체 파일 줄 수

빈 줄·주석을 포함하고 마지막 개행을 별도 빈 줄로 세지 않는 물리 줄 수입니다. 파일 이동·줄바꿈 압축은 없습니다.

| 분류 | 파일 | 변경 전 | 변경 후 | 차이 |
|---|---|---:|---:|---:|
| 실행 코드·읽기 참조 | `tools/performance/html-report.mjs` | 243 | 243 | 0 |
| 테스트 데이터 | `tools/performance/fixtures/historical-gate-report.json` | 197 | 123 | -74 |
| 테스트 코드 | `tools/performance/html-report.test.mjs` | 280 | 290 | +10 |

실행 코드 감소는 **0줄**, 테스트 데이터 감소는 **74줄**입니다. 테스트와 데이터를 합친 순감소 64줄을 제품 코드 감축으로 표현하지 않습니다. 이 문서는 별도 문서 추가입니다.

## 검증 결과와 한계

- 변경 전후 `node --test tools/performance/html-report.test.mjs`: 각각 **13개 통과, 실패 0개**입니다. 과거 기준 보존, 원본 불변, 오류·불완전 측정, HTML escaping, Android 입력과 실제 CLI 동작 검사가 포함됩니다.
- `git show 921ef881:tools/performance/fixtures/historical-gate-report.json`으로 읽은 기준 자료에서 최상위 `samples`만 제외한 객체와 현재 fixture가 `assert.deepEqual`로 일치했습니다. 다른 기준·결과·metadata는 바뀌지 않았습니다.
- 실제 `renderPerformanceReport`에 기준/현재 fixture를 각각 전달한 HTML 전체가 `assert.equal`로 일치했습니다. 생성된 UTF-8 HTML은 양쪽 모두 **16,461바이트**입니다.
- 소유 변경 파일의 `git diff --check`를 통과했습니다. 제품 결함 수정이 아니라 중복 테스트 자료 제거이므로 수정 전 실패를 재현했다고 주장하지 않습니다.

브라우저 조작·E2E 재실행·새 성능 측정·원격 CI는 수행하지 않았습니다. renderer와 생성 HTML 전체가 같으므로 이번 변경의 검증은 직접 소비 테스트와 결과 동일성에 한정했습니다. commit·push·배포는 수행하지 않았습니다.
