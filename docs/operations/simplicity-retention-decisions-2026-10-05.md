# 호환·통계 경로의 유지 결정과 종료 조건

전체 정비는 무조건 줄 수를 줄이는 작업이 아닙니다. 아래 조건부 후보는 실제 소비자와 보존 계약을 다시 확인해 유지로 결정했습니다. 새 우회 계층·추정 자료·호환 분기를 추가하지 않았으며 운영 자료 이관이나 삭제는 수행하지 않았습니다.

| 후보 | 확인한 사실과 결정 | 제거 조건 |
|---|---|---|
| FIN-06 지역화폐 이중 저장 | `firebaseLocalCurrencyBalanceStore`의 legacy-unknown 읽기와 `firebaseHomePreferenceAtomicStore`의 첫 유형 선택이 아직 legacy 자료를 실제로 읽습니다. writer만 제거하면 두 읽기 계약의 원본이 달라집니다. canonical/legacy 원자 저장을 유지합니다. | 유형 미상 값을 임의 분류하지 않는 일회 자료 이관, canonical-only·legacy-only·혼합 가구의 잔액·첫 선택 동등성, 지원 클라이언트의 legacy 소비 종료를 확인한 뒤 reader와 writer를 함께 제거합니다. |
| FIN-07 배당 초기 이력 복구 | `firebaseDividendHoldingQuery`가 실제로 `readMigratedPositionHistory`를 사용합니다. 이 함수는 완료·전량 적용된 migration의 정확한 경로·가구·종목·수량만 증거로 사용합니다. 현재 수량을 과거로 소급하지 않습니다. 10월 2일 누락을 막는 경로이므로 유지합니다. | 같은 증거 검증으로 승인된 canonical 초기 이력 backfill을 수행하고 모든 계좌·공시 기준일의 적격 수량과 분배금 합계가 동일함을 확인해야 합니다. paid 기록과 migration 원본을 보존하고 재실행 멱등성을 증명한 뒤 삭제합니다. |
| Capture 8 legacy Shortcut 알림 guard | `FirebaseLegacyShortcutNotificationGuard`는 이미 전송을 시작했던 구 Inbox를 새 소비자가 재전송하지 않도록 막습니다. 실제 reconciliation도 아직 `in-progress` 구 Inbox를 처리합니다. 코드 검색으로 운영 잔여 기록이 없음을 증명할 수 없으므로 유지합니다. | 구 producer 중단 시점, 남은 진행 Inbox의 terminal 처리, 구 이벤트 재전달/보관 기간 종료를 운영 기록으로 확인해야 합니다. 그 뒤 dispatcher guard와 legacy reconciliation을 함께 제거하되 기존 terminal unknown 결과를 재전송하지 않습니다. |
| A10 관리자 가구 목록 | 명령의 단건 조회는 이미 가구 문서 하나로 제한했습니다. 목록은 Timestamp·ISO 문자열·없는 createdAt을 같은 ISO 기준으로 정규화하고, purged 제외 후 같은 시각 ID 순서와 기존 offset cursor를 적용합니다. 바로 DB orderBy로 옮기면 누락 필드가 빠지고 혼합 타입의 정렬 결과가 달라집니다. 호환 query 조합을 새로 만드는 대신 목록 조회를 유지합니다. 과거 날짜 latency 예외는 이미 제거했습니다. | createdAt 형식·누락 값 정규화와 cursor 전환을 승인된 자료 이관 단위로 처리한 뒤 단일 indexed query로 바꿉니다. 대시보드용 추상 캐시를 측정 없이 추가하지 않습니다. |
| W7 지출 통계 캐시 | 같은 전체 응답의 참조 재사용은 검증 완료 때 차트 애니메이션이 재시작되는 것을 막습니다. 확정 메모·카테고리 변경은 동일 actor·직전 revision·정확한 predecessor version·완전한 보관 범위를 증명할 때만 적용하고 나머지는 무효화합니다. 이 정책을 차트와 편집 화면 각각으로 옮기면 상태와 조건이 중복됩니다. 한 캐시에 유지합니다. | 의미가 같은 응답의 애니메이션 안정성, 수정 직후 재조회 없는 반영, 가구 전환/늦은 응답 차단을 더 적은 상태로 지킬 대안이 있을 때 교체합니다. 지금은 별도 추상화나 비교 helper를 추가하지 않습니다. |

이 결정은 운영 자료 이관이 끝났다는 의미가 아닙니다. 현재 코드 정비 범위에서 유지할 계약을 확정한 것입니다. 실제 migration 실행은 별도 자료 변경 요청과 dry-run 검증이 필요합니다.

## TOOL-04: 과거 비교 도구의 범위 명확화

`reconcile:runtime`을 `reconcile:legacy-runtime`으로, 실행 파일을 `reconcile-legacy-runtime.mjs`로 변경했습니다. help와 보고서에 초기 canonical 이관 비교라는 범위를 표시합니다. 현재 categoryCatalog를 검사한다고 오해할 수 있는 배포 안내를 수정했고 현재 저장소 정비 runbook으로 연결했습니다. storage-consolidation의 기존 normalizer 소비자는 새 파일로 연결해 같은 비교를 유지합니다.

읽기 전용·원문 비노출 경계와 비교/정본 정리 관련 3개 파일 14개, CLI help 실행 통과. 운영 자료 조회·수정은 하지 않았습니다.
