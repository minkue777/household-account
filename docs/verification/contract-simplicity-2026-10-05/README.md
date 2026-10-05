# 전체 계약별 단순화 검토

기준 SHA: `676731d9abda95439afc2dfd827690029d89e048`. `contract-simplicity` 절차로 남은 계약을 입력·결과·실패·저장 경계와 실제 소비자에 연결했습니다. 기존 감사에서 변동 없는 영역은 해당 근거를 재사용하고 새 후보를 구현했습니다. 검토 완료와 미구현 목표 기능 구현은 다른 상태입니다. 목표 명세를 삭제하거나 새 기능을 암묵적으로 추가하지 않았습니다.

[고정 모듈·요구사항 목록](scope.json)의 모든 항목은 아래 상세 계약 판정표에 연결됩니다. 이전 두 통계 단순화는 완료 근거를 재사용하며 이번 감축에 중복 산입하지 않습니다.

| 모듈 | 요구사항 수 | 계약별 변경·유지 근거 |
|---|---:|---|
| household-access | 19 | [platform](platform.md) |
| categories-budget | 6 | [finance](finance.md) |
| ledger | 26 | [finance](finance.md) |
| local-currency | 5 | [finance](finance.md) |
| recurring-transactions | 6 | [finance](finance.md) |
| notifications | 14 | [capture-notifications](capture-notifications.md) |
| android-payment-ingestion | 38 | [capture-notifications](capture-notifications.md) |
| payment-configuration | 12 | [capture-notifications](capture-notifications.md) |
| shortcut-ingestion | 15 | [capture-notifications](capture-notifications.md) |
| asset-automation | 5 | [portfolio](portfolio.md) |
| dividends | 8 | [portfolio](portfolio.md) |
| holdings-market-data | 17 | [portfolio](portfolio.md) |
| portfolio | 9 | [portfolio](portfolio.md) |
| android-host | 27 | [platform](platform.md) |
| delivery-assurance | 4 | [platform](platform.md) |
| external-operations | 6 | [platform](platform.md) |
| home-preferences | 5 | [platform](platform.md) |
| pwa | 8 | [platform](platform.md) |
| reporting | 9 | [platform](platform.md) |

합계 **19개 모듈·239개 요구사항 항목**입니다. 같은 저장 경계를 쓰는 공개 계약도 상세 표에서 각각 식별합니다. Android QuickEdit는 platform과 수집 보고서 양쪽에서 연결하되 코드량은 중복 합산하지 않습니다.

## 구현 결과

- 원장·정기지출·카테고리·Shortcut의 실제 경로와 별개로 남아 있던 구현 및 전용 타입을 제거했습니다. 실제 수정/분할 경합, 발급·설치 UI, 카테고리 mapper/Provider 검사를 보존·보강했습니다.
- 자산·보유 입력은 첫 실패를 직접 반환하고, 자동화의 동일 격리 저장을 한 함수로 처리합니다. 금 시세는 확정 Asset에서 직접 계산하고 수량 초안은 독립 유지합니다.
- 지출 수정·삭제는 같은 pending/실패 복구 흐름을 사용하고, 새 편집 인스턴스만 폼을 초기화합니다.
- 홈 카드 키 해석은 한 표를 사용하며 일반 객체의 상속 키가 허용값으로 오인되는 기존 오류를 Map으로 교정했습니다. PWA 알림 단순 전달은 실제 함수의 이름 있는 재수출로 바꿨습니다.
- 세션·권한·호환 저장·내구 큐·취소 증거·배당 과거 수량·원자성·멱등성·실패/빈 값 구분은 상세 유지 이유가 있는 계약입니다. 이를 없애 감축률을 맞추지 않았습니다.

## 코드량

이번에 **실제로 바뀐 실행 파일 44개 전체**는 **7,061 → 5,195줄**, **1,866줄 감소**입니다. [파일별 재현 원장](runtime-change-scope.json)을 기준으로 하며 저장소 전체 감소율로 표현하지 않습니다. 새 실행 파일로 옮기거나 테스트·문서 삭제량을 섞지 않았습니다. 각 보고서의 넓은 검토 범위 분모는 별도이며 서로 더해 전체 저장소 크기로 사용하지 않습니다.

## 검증·전달

- 관련 정책/adapter/UI 검사와 타입 검사를 수행했습니다. 세부 실행은 각 보고서와 [전달 기록](../../operations/all-contract-simplicity-2026-10-05.md)에 있습니다.
- 실제 Firestore 통합 4파일 33개 통과: 원장 저장·수정/분할 경합, 지역화폐 최초 선택/잔액, 자동화 실행, Shortcut 교체.
- 교차 검토에서 입력 오류 우선순위·자동화 read/write 순서·금 초안·편집 인스턴스·홈 키 호환성을 대조했습니다.
- 브라우저·원격 CI·Firebase/Web 배포는 전달 기록의 상태를 따릅니다. Android 실행 코드와 APK, 운영 금융 데이터는 변경하지 않습니다.
