---
name: etf-stock-sync
description: Household-account 프로젝트의 국내 ETF 종목 데이터를 최신화한다. 사용자가 "ETF 목록 최신화", "누락 ETF 추가", "신규 상장 ETF 반영", "KODEX/TIGER/RISE/ACE 등 ETF가 검색에 안 보인다", "stocks.json ETF 동기화"처럼 한국 ETF 검색 데이터 갱신을 요청할 때 사용한다.
---

# ETF Stock Sync

## Overview

`web/src/data/stocks.json`을 네이버 금융 ETF 전체 목록 기준으로 동기화한다. 코드 기준 누락 ETF를 추가하고, 이미 있는 ETF의 이름이 바뀐 경우 최신명으로 맞춘다.

## Workflow

1. 작업 전 `git status --short`로 변경 파일을 확인한다. 사용자 변경이 있으면 덮어쓰지 말고 이번 작업 파일과 충돌하는지만 판단한다.
2. repo root에서 동기화 스크립트를 실행한다.

```bash
node .codex/skills/etf-stock-sync/scripts/sync-etfs.mjs
```

3. 출력의 `missing before`, `renamed before`, `added`, `renamed`를 확인한다.
4. 다음 검증을 실행한다.

```bash
node .codex/skills/etf-stock-sync/scripts/sync-etfs.mjs --check
npm --prefix web run build
```

5. 변경 파일은 보통 `web/src/data/stocks.json` 하나여야 한다. diff를 확인한다.
6. 사용자가 푸시를 원하거나 이 프로젝트의 일반 작업 흐름상 바로 반영해야 하면 커밋 후 푸시한다.

```bash
git add web/src/data/stocks.json
git commit -m "ETF 종목 목록 최신화"
git push
```

## Notes

- 기준 데이터는 `https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc`이다.
- API 응답은 EUC-KR로 디코딩한다. Node.js 내장 `TextDecoder('euc-kr')`를 사용하므로 별도 npm 패키지가 필요 없다.
- `stocks.json`의 `KRXGOLD` 항목은 맨 앞에 유지하고, 나머지는 종목코드 오름차순으로 정렬한다.
- Android 네이티브 코드를 바꾸지 않으므로 일반적으로 APK 재빌드는 필요 없다. 웹 검색 데이터 배포만 필요하다.
- 특정 ETF의 공식 상장일이나 상품 상세를 답해야 하면 최신 정보이므로 웹 검색으로 KODEX/TIGER/RISE/ACE 등 운용사 공식 페이지나 네이버 금융 페이지를 확인해 출처를 남긴다.
