---
name: etf-stock-sync
description: Household-account 프로젝트의 국내 ETF·ETN·주식 검색 목록을 최신 상장 종목과 동기화하고 미국 주식·ETF 실시간 심볼 공급자를 검증한다. 사용자가 "ETF 목록 최신화", "신규 상장 주식 반영", "국내/미국 종목이 검색되지 않는다", "stocks.json 동기화", "주식 목록 전체 업데이트"처럼 종목 검색 데이터 갱신을 요청할 때 사용한다.
---

# Stock Catalog Sync

## Workflow

1. `git status --short`로 사용자 변경과 `web/src/data/stocks.json` 충돌 여부를 확인한다.
2. 저장소 루트에서 동기화한다.

```bash
node .codex/skills/etf-stock-sync/scripts/sync-etfs.mjs
```

3. 출력의 국내 source 수, 미국 live source 수, `added`, `renamed`, `removed`를 확인한다.
4. 다음 검증을 실행한다.

```bash
node .codex/skills/etf-stock-sync/scripts/sync-etfs.mjs --check
npm --prefix web run build
```

5. `web/src/data/stocks.json`, 스킬 변경과 기존 사용자 변경을 구분해 diff를 검토한다.
6. 사용자가 명시적으로 요청한 경우에만 한국어 메시지로 커밋하고 푸시한다.

## Data contract

- KOSPI·KOSDAQ 주식/ETF/ETN은 네이버 모바일 증권 전체 시장 목록을 사용한다.
- KONEX 주식은 KRX KIND 상장법인 목록을 사용한다.
- 네이버 ETF 전체 목록으로 KOSPI ETF 누락과 이름 불일치를 교차 검증한다.
- `stocks.json`은 현재 상장 snapshot이다. 신규 종목을 추가하고 이름을 갱신하며 source에서 사라진 상장폐지·만기 종목은 검색 목록에서 제거한다.
- `KRXGOLD*` 항목은 파일 맨 앞에 유지하고 나머지는 코드 오름차순으로 정렬한다.
- 미국 주식·ETF는 정적 JSON에 저장하지 않는다. 런타임이 NASDAQ Trader의 `nasdaqlisted.txt`와 `otherlisted.txt`를 12시간 cache로 읽으므로 스크립트는 두 공급자의 응답·최소 개수·중복 제거 결과를 검증한다.
- 동기화 실패나 비정상적으로 작은 응답에서는 파일을 쓰지 않는다.
