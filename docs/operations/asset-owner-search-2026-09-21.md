# 자산 추가 명의 초기 표시와 종목 검색 결과 접근성

## 원인과 요구사항

- AST-001 / T-AST-010: 명의 필터에서 지운을 선택하고 자산 추가를 열어도 `AssetAddModal`은 첫 소유자를 가구로 초기화했다. effect에서 기본 명의를 적용해 실제 Portal DOM의 commit 순서가 `가구 → 지운`이었다. 추가 모달은 첫 commit부터 유효한 기본 명의·유형·세부 유형을 선택해야 한다. 기본 명의가 없거나 선택 목록에 없으면 첫 허용 명의를 사용한다.
- MARKET-003 / T-MARKET-005: 2026-09-21 06:00 정상 발행 카탈로그 17,522개에서 `미국나스닥`은 30개가 일치하고 RISE 미국나스닥100(368590)은 12번째였다. `미국나스닥100`은 24개가 일치하고 RISE는 8번째였다. 기기 검색의 최대 10개 절단 때문에 넓은 검색어에서 종목이 사라졌다. 모든 일치 결과를 끝까지 선택할 수 있어야 한다.

## 상세 설계와 계약

1. 추가 모달의 state initializer에서 `defaultOwnerKey`를 허용 목록에 대조한다. 기본 유형의 첫 세부 유형도 initializer에 적용한다. 재개방 시 기존 초기화 effect와 동일한 명의 선택 함수를 사용한다. 소유자 저장 DTO·권한·명의 프로필·운영 데이터는 변경하지 않는다.
2. `searchPreparedStockCatalog`와 `LocalStockInstrumentCatalog.search`의 기기 검색 개수 인자를 제거한다. 기존 이름·코드·별칭 관련도와 market/code 정렬, 중복 제거, 빈 검색 결과, 캐시·원격 갱신 규칙은 유지한다. `portfolioQueries.searchStocks`는 모든 기기 검색 결과를 전달한다.
3. `StockSearchForm`의 결과 목록은 처음 30개만 DOM에 표시하고 하단 64px 이내 스크롤 또는 더 보기 버튼으로 30개씩 추가한다. 마지막 묶음에서는 남은 개수만 표시한다. 검색어를 key로 한 결과 목록을 사용해 검색어 변경·선택 취소 시 표시 범위와 스크롤이 새로 시작한다. 키보드 사용자는 더 보기 버튼으로도 후속 결과에 접근한다. 추가 표시에는 네트워크 요청이 없다.
4. 서버 호환 `SearchInstruments`의 `limit≤10`·`truncated` 응답과 코인 검색은 유지한다. 카탈로그 저장 스키마·공개 객체·Functions·Android 실행 코드는 바뀌지 않는다. Web Git 자동배포가 적용 대상이다.

## 테스트 추적성

| 요구사항 | 검증 | 검증 파일 |
|---|---|---|
| AST-001 / T-AST-010 | 실제 Portal의 모든 commit에서 선택 명의·기본 세부 유형이 일치, 기본 명의 누락·유효하지 않은 명의 fallback, 닫은 후 다른 명의로 재개방 | `web/src/__tests__/features/portfolio/assetAddModalInitialPaint.contract.test.tsx` |
| MARKET-003 / T-MARKET-005 | 10개 초과 부분 일치, RISE 12번째 포함, 좁은 검색어에서도 포함, 중복 제거·정렬·빈 검색·원격 호출 경계 | `web/src/__tests__/features/portfolio/localStockInstrumentCatalog.contract.test.ts`, `portfolioQueries.contract.test.ts` |
| MARKET-003 / T-MARKET-005 | 30개 단위 스크롤·더 보기, 마지막 종목 선택, 검색어 변경 시 표시 범위·스크롤 초기화 | `web/src/__tests__/features/portfolio/stockSearchResults.contract.test.tsx` |
| MARKET-003 / MARKET-005 | 실제 공급자 Adapter·Storage SDK·gzip·checksum·IndexedDB 경계의 500개 결과를 브라우저 스크롤로 마지막 항목까지 접근, 후속 검색·오프라인 캐시 유지 | `web/e2e/portfolio-market-catalog.spec.ts` |

## 로컬 검증

- 관련 Jest 5개 파일, 15개 테스트 통과(추가 모달 4, 검색 결과 UI 2, 기기 카탈로그 5, Query 경계 3, 관리자 지연 화면 1).
- `web: npx tsc --noEmit` 통과. 기존 관리자 지연 화면 테스트의 `getByRole`에 있던 지원하지 않는 `exact` 옵션도 제거했다. 문자열 `name`의 정확한 접근성 이름 매칭과 기존 검증은 유지한다.
- 500개 결과의 실제 브라우저 스크롤 검증과 전체 CI는 배포 후보 SHA에서 확인하며, 미완료 상태를 성공으로 기록하지 않는다.
