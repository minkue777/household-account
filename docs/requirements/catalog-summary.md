# 요구사항·테스트 선언 집계

`node tools/requirements/update-catalog.mjs`로 생성합니다. 실행 결과나 구현 완료 개수가 아닌 문서 선언 집계입니다.

- 요구사항: 244개 (고유 ID 244개)
- Canonical 테스트 시나리오 ID: 228개

| 소유 영역 | 요구사항 |
|---|---:|
| access-household | 19 |
| household-finance | 40 |
| notifications | 14 |
| payment-capture | 65 |
| portfolio | 39 |
| supporting-platform | 58 |
| system | 9 |

| 모듈 | 요구사항 | 테스트 시나리오 ID |
|---|---:|---:|
| [contexts/access-household/modules/household-access](contexts/access-household/modules/household-access/requirements.md) | 19 | 15 |
| [contexts/household-finance/modules/categories-budget](contexts/household-finance/modules/categories-budget/requirements.md) | 6 | 7 |
| [contexts/household-finance/modules/ledger](contexts/household-finance/modules/ledger/requirements.md) | 23 | 23 |
| [contexts/household-finance/modules/local-currency](contexts/household-finance/modules/local-currency/requirements.md) | 5 | 8 |
| [contexts/household-finance/modules/recurring-transactions](contexts/household-finance/modules/recurring-transactions/requirements.md) | 6 | 8 |
| [contexts/notifications/modules/notifications](contexts/notifications/modules/notifications/requirements.md) | 14 | 14 |
| [contexts/payment-capture/modules/android-payment-ingestion](contexts/payment-capture/modules/android-payment-ingestion/requirements.md) | 38 | 22 |
| [contexts/payment-capture/modules/payment-configuration](contexts/payment-capture/modules/payment-configuration/requirements.md) | 12 | 12 |
| [contexts/payment-capture/modules/shortcut-ingestion](contexts/payment-capture/modules/shortcut-ingestion/requirements.md) | 15 | 15 |
| [contexts/portfolio/modules/asset-automation](contexts/portfolio/modules/asset-automation/requirements.md) | 5 | 5 |
| [contexts/portfolio/modules/dividends](contexts/portfolio/modules/dividends/requirements.md) | 8 | 8 |
| [contexts/portfolio/modules/holdings-market-data](contexts/portfolio/modules/holdings-market-data/requirements.md) | 17 | 15 |
| [contexts/portfolio/modules/portfolio](contexts/portfolio/modules/portfolio/requirements.md) | 9 | 12 |
| [supporting-platform/modules/android-host](supporting-platform/modules/android-host/requirements.md) | 26 | 20 |
| [supporting-platform/modules/delivery-assurance](supporting-platform/modules/delivery-assurance/requirements.md) | 4 | 4 |
| [supporting-platform/modules/external-operations](supporting-platform/modules/external-operations/requirements.md) | 6 | 6 |
| [supporting-platform/modules/home-preferences](supporting-platform/modules/home-preferences/requirements.md) | 5 | 5 |
| [supporting-platform/modules/pwa](supporting-platform/modules/pwa/requirements.md) | 8 | 7 |
| [supporting-platform/modules/reporting](supporting-platform/modules/reporting/requirements.md) | 9 | 13 |
| [system/context.md](system/context.md) | 9 | 7 |

| 선언 상태 | 요구사항 |
|---|---:|
| 결함 | 38 |
| 목표 명세 | 80 |
| 임시 진단 | 1 |
| 특성화 | 3 |
| 특성화·목표 교정 | 1 |
| 현재 명세 | 108 |
| 현재 명세·목표 보완 | 3 |
| 현재·목표 | 3 |
| 호환 | 3 |
| 호환·목표 | 2 |
| 호환·목표 명세 | 1 |
| 호환·현재 명세 | 1 |
