# CI 성능 HTML 보고서

CI는 성능 측정이 남긴 JSON으로 독립 HTML을 만들고, 완료 후 보고서 전용 GitHub Pages에 게시합니다. 보고서 생성·게시에는 E2E 재실행이나 앱·Firebase 재배포가 필요하지 않습니다. 현재 Web·Android 성능은 [보고 전용 정책](./performance-report-only-2026-09-17.md)에 따라 소요 시간으로 통과·실패를 판정하지 않습니다. 측정 표본과 시작·종료 시점은 유지합니다.

## 보고서 열기

1. GitHub 저장소의 **Actions → 독립 품질 CI → 해당 실행 → Summary**를 엽니다.
2. **Web 성능 그래프** 또는 **Android 성능 그래프**의 **보고서 바로 보기** 링크를 누릅니다.
3. 압축 해제나 GitHub 로그인 없이 브라우저에서 그래프가 열립니다. CI 종료 직후에는 별도 **성능 보고서 게시** 작업이 완료될 때까지 잠시 기다려야 합니다.

| 주소 | 내용 |
|---|---|
| [최신 Web 보고서](https://minkue777.github.io/household-account/web.html) | 가장 최근 완료된 Web 측정 |
| [최신 Android 보고서](https://minkue777.github.io/household-account/android.html) | 가장 최근 Android 측정. 이번 CI에서 Android를 측정하지 않았다면 이전 측정 결과와 시각을 그대로 표시 |
| `https://minkue777.github.io/household-account/runs/<실행 ID>/web.html` | 해당 CI 실행의 Web 측정 |
| `https://minkue777.github.io/household-account/runs/<실행 ID>/android.html` | 해당 CI 실행의 Android 측정 |

게시 작업은 최근 완료된 main CI 20개의 사용 가능한 보고서를 보관합니다. 해당 범위를 벗어나거나 원본 아티팩트가 만료되면 실행별 공개 링크도 제거됩니다. 원본 JSON·Markdown·진단 파일은 기존 **Artifacts**에 보관하며 필요한 경우에만 다운로드합니다. Android 검사가 변경 범위에 해당하지 않으면 해당 실행의 Android 보고서는 없습니다. 측정 실패 시에도 생성된 HTML을 게시하지만, 빌드·환경 준비 실패처럼 HTML 생성 단계에 도달하지 못한 경우는 실행 로그를 확인해야 합니다.

GitHub의 artifact 링크는 ZIP 다운로드 주소여서 HTML 바로 보기 링크로 안내하지 않습니다. GitHub Pages는 정적 HTML을 브라우저에 제공합니다. [GitHub Pages 공식 문서](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## 게시 범위와 재게시

`.github/workflows/performance-pages.yml`은 **독립 품질 CI**가 끝나면 실행되고, 수동 실행도 지원합니다. 이전 결과를 다시 게시하려면 **Actions → 성능 보고서 게시 → Run workflow**를 실행합니다. 테스트를 다시 돌리지 않습니다.

게시 도구는 같은 저장소의 main에서 실행된 push·수동 CI만 선택하고, GitHub가 제공하는 실행·아티팩트의 커밋 출처를 확인합니다. Web JSON의 커밋도 같은지 대조합니다. 커밋 필드가 없는 기존 Android 보고서는 GitHub 실행 출처로 확인하고, 커밋 필드가 있으면 추가 대조합니다. 명시된 `web.html`·`android.html`만 게시하며 원본 JSON, 실패 화면, DOM, 로그, trace는 공개 사이트에 복사하지 않습니다. 보고서는 합성 데이터로 측정한 시간과 CI 환경 정보이며 운영 가계부의 거래 정보는 포함하지 않습니다. 공개할 보고서가 하나도 없으면 기존 사이트를 빈 내용으로 덮지 않고 게시를 실패 처리합니다.

측정 결과·당시 기준·그래프 내용은 다시 계산하지 않고 생성된 HTML 그대로 게시합니다. 앱의 Vercel 배포와 보고서용 Pages 배포는 독립적입니다.

## 그래프와 참고선 읽기

- 보고서는 **기능별 가로막대 그래프**로 시작합니다. 막대 길이는 선택한 참고 시간 대비 비율이며, **100% 선**은 비교용입니다. 서로 다른 기능의 막대 길이를 절대 소요 시간으로 비교하지 않습니다.
- 기본 화면은 **WebKit · 중앙값 · CI 참고선**입니다. 환경, **중앙값 / 반복 / 최대**, **CI / UX**를 바꿔 비교할 수 있습니다. WebKit 결과가 없으면 첫 번째 환경을 표시합니다. 반복 그래프는 정렬된 본 표본 중 필요한 횟수에 해당하는 값이며, 7회 측정에서는 여섯 번째로 빠른 값을 반복 참고 시간과 비교합니다.
- 기능 행을 펼치면 정확한 **측정값·참고값(ms)**, 개별 표본과 참고선 초과 항목을 확인할 수 있습니다. 완전한 측정은 **측정 완료**로 표시하며, 느리다는 이유로 통과·실패를 표시하지 않습니다. 표본 누락·유효하지 않은 값·측정 실행 오류는 측정 완료로 표시하지 않습니다.
- **CI 참고선**은 해당 실행에 선택된 프로필입니다. 현재 GitHub CI는 `github-hosted-v2`를 사용하며 일부 WebKit·Android 지표에 실행 환경별 참고값을 적용합니다.
- **UX 목표**는 공통 `ux-v2` 참고값입니다. CI 환경 참고선과 제품의 UX 목표를 구분해서 보세요. 두 비교 모두 CI 성공 여부에 영향을 주지 않습니다.
- **중앙값**, **반복 측정 중 참고 시간 이내 횟수**, **개별 측정 최대 시간**을 계속 기록합니다. 정식 7회 측정에서는 반복 참고선 이내 6회 여부를 보여 주며, 준비 실행은 집계에서 제외합니다.
- 보고서는 원본 JSON의 측정 방식과 결과를 표시합니다. 과거 PASS/FAIL 방식으로 기록한 JSON은 당시 판정을 유지하며 새 정책으로 재판정하지 않습니다. 실제 휴대폰과 운영 네트워크의 속도를 보장하는 수치는 아닙니다.

## 기존 JSON으로 다시 만들기

저장소 루트에서 다음 명령을 실행합니다. 원본 JSON에 당시 기준이 저장되어 있으므로 현재 기준으로 다시 판정하지 않습니다.

```sh
node tools/performance/html-report.mjs input.json output.html
```

예를 들어 다운로드한 `web.json`이나 `android.json`을 입력으로 사용할 수 있습니다. 생성한 HTML은 단독으로 열 수 있으며, 대형 측정 JSON·HTML 결과물은 Git에 추가하지 않습니다.
