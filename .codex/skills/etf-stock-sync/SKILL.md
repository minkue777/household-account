---
name: etf-stock-sync
description: Household-account 프로젝트의 한국·미국 종목 검색 목록에 대해 자동 갱신 상태, 최신 상장 종목 반영과 ETF 분류를 점검하거나 수정한다. 종목 목록 최신화나 신규 종목 검색 누락 요청에 사용하며, 보유자산 가격 갱신과는 구분한다.
---

# Stock Catalog Sync

## 현재 경로

- `instrumentCatalogDaily`가 매일 06:00 `Asia/Seoul`에 한국·미국 목록을 함께 발행한다.
- 원본은 Cloud Storage `market-catalog/v1/latest.json`과 manifest가 가리키는 gzip snapshot이다. `stocks.json` 파일·fallback과 미국 별도 12시간 live cache는 사용하지 않는다.
- Web은 Storage snapshot을 IndexedDB·메모리에 저장해 검색하며 5분 간격으로 manifest를 확인한다. 보유자산 가격은 별도 Query에서 조회한다.
- [실제 공급자 Adapter](../../../functions/src/adapters/firebase/portfolio/firebaseInstrumentCatalog.ts), [요구사항](../../../docs/requirements/contexts/portfolio/modules/holdings-market-data/requirements.md)의 `MARKET-005`를 기준으로 삼는다.

## 점검

1. `git status --short`로 사용자 변경을 확인한다. 읽기 전용 확인 요청에서는 배포나 수동 갱신을 실행하지 않는다.
2. 운영 Scheduler의 활성 상태·최근 실행과 `instrument-catalog-daily`의 실제 COMPLETE/실패 로그를 확인한다. manifest의 발행 시각·종목 수와 snapshot의 generation·SHA-256·실제 항목 수를 대조한다.
3. 현재 공급자 목록을 실제 Adapter와 같은 규칙으로 읽어 code·name·instrumentType의 추가·변경·제외를 비교한다. NASDAQ 원본의 `File Creation Time`과 HTTP Last-Modified도 확인한다. manifest의 `sources[].asOfDate`는 수집일이며 원천 작성일을 보장하지 않는다.
4. 최신 상장 대표 종목을 거래소·운용사의 공식 자료와 교차 확인한다. 일일 갱신 이후의 원천 변경, 원천 오류, 앱의 누락·분류 오류를 구분한다.

## 수정과 반영

- 공급자 처리 수정은 실제 Adapter를 실행하는 `functions/test/adapters/firebase/instrument-catalog-source.test.ts`와 브라우저의 `web/e2e/portfolio-market-catalog.spec.ts`를 기준으로 검증한다. 정규화 결과만 대역으로 고정해 파서를 건너뛰지 않는다.
- 코드 수정·배포는 [household-delivery](../../../.agents/skills/household-delivery/SKILL.md)를 따른다. Functions 변경이면 Firebase wrapper로 배포하고 해당 SHA의 CI를 확인한다.
- 날짜별 snapshot은 immutable이며 같은 날짜의 성공 run은 receipt를 재생한다. 다음 정기 발행에 반영되는 수정과 이미 운영 목록에 반영된 결과를 구분한다. 같은 날짜 객체를 강제로 덮어쓰거나 다음 날짜로 위장해 즉시 갱신하지 않는다.

## Data contract

- 국내는 KOSPI·KOSDAQ 주식·ETF·ETN만 포함하고 KONEX는 제외한다. 네이버 전체 시장 목록과 KIND의 유가·코스닥 법인을 사용하며 영문 포함 6자리 종목코드도 보존한다.
- 시장 목록의 ETF 유형과 네이버 ETF 전용 목록을 함께 사용한다. ETF 전용 목록에 없다는 이유로 시장 원천의 ETF를 일반 주식으로 바꾸지 않는다.
- 미국은 NASDAQ Trader의 `nasdaqlisted.txt`와 `otherlisted.txt`를 사용하며 테스트 심볼을 제외하고 code를 중복 제거한다.
- 실패·불완전한 페이지·비정상적으로 작은 응답은 발행하지 않고 마지막 성공본을 유지한다. 최근 서로 다른 성공 날짜 3개를 보관한다.
- 검색 목록 제외는 기존 사용자의 보유종목·거래·과거 자산 이력을 삭제하는 작업이 아니다.
