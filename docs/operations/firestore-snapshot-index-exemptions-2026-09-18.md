# 스냅샷 내부 데이터의 Firestore 색인 제외

2026-09-18 문서 저장 효율화 4번 작업입니다. 문서 내용·보존 기간·조회 결과는 바꾸지 않고, 실제 검색에 사용하지 않는 payload의 자동 색인만 제외합니다. 설정 원본은 [firestore.indexes.json](../../firestore.indexes.json)입니다.

## 대상과 실제 조회 근거

| Collection group | 색인 제외 필드 | 문서 접근 방식과 유지하는 색인 |
|---|---|---|
| `assetSnapshots` | `byType`, `byOwnerRefKey`, `ownerDisplayNames`, `sourceAssetVersions` | 가구 하위에서 `localDate` 범위·오름차순/내림차순 정렬, 문서 ID cursor 또는 날짜 문서 ID 직접 조회. `localDate`와 `householdId` 기본 색인 유지 |
| `dividend_snapshots` | `events`, `monthlyData`, `monthlyAmounts` | 최상위 `householdId` equality query 후 메모리에서 연도·종목·날짜 선택. `householdId`와 `year` 기본 색인 유지 |

실행 경로를 확인한 근거는 다음과 같습니다.

- 자산 통계: [assetStatisticsReadModel](../../web/src/platform/reporting/assetStatisticsReadModel.ts)은 시작일 직전 baseline을 `localDate <= startDate`, 내림차순, `limit(1)`로 읽고 선택 기간을 `localDate`·문서 ID 순으로 page 조회합니다. 유형·명의자 map은 반환된 문서에서 차트 자료로 펼칩니다.
- 자산 전일 대비: [assetDailyChangeReadModel](../../web/src/platform/read-model/assetDailyChangeReadModel.ts)은 `localDate < today`의 최신 한 문서를 읽고 명의자별 금액을 메모리에서 참조합니다.
- 자산 스냅샷 Writer: [firebaseAssetSnapshotProjection](../../functions/src/adapters/firebase/portfolio/firebaseAssetSnapshotProjection.ts)은 직전 문서에 같은 날짜 쿼리를 사용합니다. 당일 기록과 `sourceAssetVersions`·checkpoint 재생 비교는 날짜 문서 ID의 transaction get 후 수행합니다.
- 과거 자산 이관: [migrate-asset-history](../../functions/scripts/migrate-asset-history.mjs)의 `collectionGroup('assetSnapshots').get()`은 필터 없는 전체 조회입니다. 내부 map의 필터·정렬을 사용하지 않습니다.
- 배당 Web: [assetService의 getDividendSnapshot](../../web/src/lib/assetService.ts)은 가구 조건 조회 후 연도 문서 ID를 고르고 `events`와 12개월 배열을 읽습니다.
- 배당 서버: [firebasePortfolioDividendProjectionReader](../../functions/src/adapters/firebase/portfolio/firebasePortfolioDividendProjectionReader.ts)는 가구 조건 조회 후 `events`에서 종목·최근 1년을 선택합니다. [firebaseDividendEventRuntimeRepository](../../functions/src/adapters/firebase/dividends/firebaseDividendEventRuntimeRepository.ts)는 연간 문서를 결정적 ID로 저장하며 `monthlyData`·`monthlyAmounts`는 같은 월 합계의 저장 표현입니다.
- 가구 purge는 가구 단위 또는 collection 단위 조회·삭제를 사용합니다. 이번 제외 필드의 값으로 검색하지 않습니다.

Web·Functions·Android 실행 코드와 운영 도구에서 위 필드 또는 하위 경로를 `where`·`orderBy` 조건으로 사용하는 경로가 없는지 확인했습니다. 자산 `AST-004`, `AST-008`과 배당 `DIV-004`의 결과·보존 계약은 그대로입니다. 컬렉션 전체 `*` 제외를 사용하지 않고, 현재 필요한 최상위 필드와 기존 복합 색인·TTL 설정을 유지합니다.

## 효과와 한계

Firestore는 map을 색인에서 제외하면 그 하위 필드도 제외 설정을 상속합니다. 단일 필드 제외는 복합 색인까지 제거하지 않으므로, 이번 내부 payload가 기존 복합 색인에 포함되지 않았는지도 검사합니다. [Firebase 공식 색인 설명](https://firebase.google.com/docs/firestore/query-data/index-overview#single-field_index_exemptions)

따라서 유형·명의자·원본 자산 수나 연간 배당 이벤트 수에 따라 늘어나던 내부 필드의 자동 색인 항목과 갱신 부담이 줄어듭니다. 일반 scalar 하위 필드는 기본 오름차순·내림차순 색인의 대상이므로 각 값마다 양방향 항목이 생기던 구조입니다. 실제 절감 byte·시간은 문서 수와 값·ID 길이에 따라 달라 사전 고정 비율을 제시하지 않습니다. [Firebase 기본 색인 설명](https://firebase.google.com/docs/firestore/query-data/index-overview#automatic_indexing)

**문서 read/write 호출 수는 줄지 않습니다.** 이 변경의 직접 효과는 색인 저장 공간과 write 시 색인 유지 작업에 있습니다. 화면의 캐시·조회량·조회 결과를 바꾸거나 운영 데이터를 다시 저장할 필요가 없습니다. 기존 문서의 내용도 삭제하지 않습니다.

## 검증과 배포

- [운영 색인 계약 검사](../../functions/test/architecture/firestore-indexes.test.ts)는 map/array 제외, 하위 override·복합 색인의 재도입 없음, 날짜 양방향·가구·연도 필드 색인 보존을 확인합니다.
- 기존 자산 통계·전일 대비·배당 reader 테스트로 실제 호출 조건과 내부 자료 해석을 확인합니다. 스냅샷 projector와 배당 scheduler의 Firestore 에뮬레이터 통합 테스트로 저장·재조회·재실행 결과를 확인합니다.
- 에뮬레이터의 쿼리 성공은 운영 색인의 배포·준비 완료 또는 비용 절감을 입증하지 않습니다. 배포자는 `firestore:indexes` 배포 결과를 확인해야 하며, 색인 빌드가 필요한 추가 항목은 ready 상태 이후 의존 운영 작업을 실행합니다.
- 일반 [Firebase 배포 절차](firebase-release-runbook.md)의 변경 범위 판정을 사용합니다. 색인 설정만 바뀌었다는 이유로 Web·APK 재배포나 운영 데이터 backfill을 추가하지 않습니다. 이 문서 자체는 실제 운영 반영 완료 증거가 아닙니다.

향후 내부 map의 특정 값으로 서버 검색을 추가하려면 먼저 해당 field index 정책과 쿼리 검증을 함께 변경합니다. 원복은 지정 field override를 제거하고 필요한 색인의 준비 상태를 확인하는 방식이며 문서 데이터 복구는 필요하지 않습니다.
