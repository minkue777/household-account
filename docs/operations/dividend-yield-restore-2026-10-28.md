# 주식계좌 배당수익률 복원

## 원인과 표시 기준

이전 `api/stock/dividend`는 Naver integration 응답의 ETF `etfKeyIndicator.dividendYieldTtm` 또는 주식 `totalInfos.dividendYieldRatio`를 표시했다. 2026-07-21의 `042c7c09` 전환에서 가구 Projection 조회로 교체하며 `dividendYield: null`로 고정되어 표시가 사라졌다. `91abe7c2`의 자동 조회 변경은 조회 시점만 복원했고 이 값은 여전히 비어 있었다.

가구 Projection은 해당 가구에 저장된 배당 기록이므로 연간 이력이 완전하다고 보장할 수 없다. 이 값에 현재가를 나눠 외부 종목의 연 배당률로 표시하지 않는다. 기존과 같은 공급자 공표 수익률을 복원하며, ETF 최근 12개월 값과 주식 공급자 기준값을 임의의 예상 수익률로 바꾸지 않는다.

## 구현

- Household Query의 Auth·Membership 확인 뒤 기존 외부 Query quota를 적용한다.
- 저장 배당 Projection과 공개 종목 배당률을 병렬 조회하여 기존 응답 필드에 합친다. 요청/응답 schema는 그대로이며 구버전 Web과 호환된다.
- 별도 HTTP Adapter는 고정 HTTPS 호스트, 최대 2.5초·한 번 시도·512KiB·제한된 redirect를 사용한다. 요청한 코드와 응답 `itemCode` 및 `stockEndType`을 확인한다. 미지원 식별자·미제공·잘못된 수치는 `null`, 실제 공표 0%는 0으로 구분한다.
- 공급자 조회 실패는 진단을 남기고 배당률만 비운다. 가구 Projection 조회 실패를 정상 빈 성공으로 바꾸지는 않는다.
- Web은 저장 배당 요약이 없어도 공급자가 배당률을 제공하면 표시한다. 주당금액·수량·과거 배당 산정은 변경하지 않는다.

## 검증과 배포

- Adapter: ETF/주식의 다른 응답 필드, 실제 0%, 빈 값·잘못된 값, 미지원 식별자, 코드 불일치, HTTP 실패·재시도 없음.
- Query 조합: 제공된 배당률과 저장 Projection 조합, 공급자 실패 시 원래 Projection 유지, 외부 quota 적용, Membership 거부 시 조회 없음.
- Web: 기존 배당 표시와 배당 이력 없는 종목의 0%·양수 배당률 표시.
- 실제 public 공급자를 새 Adapter로 읽어 `368590`, `005930`의 숫자 배당률 반환을 확인했다. 이 운영 확인값을 테스트의 고정 기대값으로 쓰지 않는다.
- Firebase 세 codebase와 Vercel Git 배포 대상이며 APK 변경은 없다. 운영 금융 자료를 수정하지 않는다. 로컬 로그는 `TEMP/household-dividend-yield-*-20261028.log`에 저장한다.

## CI 후속 확인

- 제품 `37c14dd1`의 CI `40624482267`에서 Functions 2,057개는 통과했으나 registry의 외부 quota 대상 목록 검사 1개가 실패했다. 배당 조회가 실제 외부 공급자를 호출하게 된 만큼 quota 적용은 필요하며, 기존 기대 목록에 배당 Query가 빠진 테스트 갱신 누락이다.
- 정확한 목록 일치 검증을 유지하고 `portfolio.get-dividend-projection.v1`을 추가한다. 제품 코드나 quota를 제거하지 않는다. 후속 변경은 테스트·기록뿐이므로 제품 재배포는 필요하지 않다.
