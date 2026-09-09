# 메인 검색 invalid-argument 원인과 수정

2026-09-09 운영 메인 검색에서 모든 검색어가 `read/invalid-argument`로 실패했다.

## 확인된 원인

검색은 10,000건 초과 여부를 판별하려고 `limit(10_001)`을 사용했다. 운영 Firestore의 Listen 경로는 조회 한도가 10,000건을 넘으면 요청을 거절한다.

운영 배포 `ffee1a8d0880d6ab2b930b3210793428ff11a78c`의 실제 JavaScript bundle을 새 브라우저에서 실행했다. 로그인 없이 임의의 가구 ID를 사용했으며 거래 내용·사용자 토큰에는 접근하지 않았다.

| 요청 | 운영 응답 |
| --- | --- |
| `limit(10_001)` | `invalid-argument`: `Limit value in the structured query is over the maximum value of 10000.` |
| `limit(10_000)` | `permission-denied`: 미인증 요청에 대한 정상 권한 거절 |
| `limit(9_999)` 또는 `limit(1)` | `permission-denied` |
| 한도 없음 | `permission-denied` |

실제 전송 경로는 `/google.firestore.v1.Firestore/Listen/channel`이며 한도 값은 정수로 전달됐다. 같은 bundle에서 Firestore 전송을 차단하면 `unavailable`이 발생해, 쿼리 생성 단계와 운영 서버 거절도 구분했다.

이전 사용자 로그인 확인은 `getCountFromServer` 집계만 검사했고 1,767건으로 성공했다. 실제 검색의 `getDocsFromServer`는 Listen 경로를 사용하므로 이 결과로 검색 성공을 보장할 수 없었다. 로컬 에뮬레이터의 검색 테스트도 운영의 한도 거절을 재현하지 못했다. 날짜·정렬 조건 제거만으로는 오류가 해결되지 않았다.

## 수정 정책

- 검색 요청은 `limit(10_000)`을 사용한다.
- 반환 원본이 10,000건에 도달하면 전체 여부를 보장할 수 없으므로 `SOURCE_LIMIT_EXCEEDED`로 실패한다. 9,999건까지는 전체 검색과 합계를 제공한다.
- 날짜 입력 제거, 검색 원본 재사용, 최신순 정렬, 전체·월별 합계는 유지한다.
- 한도 오류에서 더 이상 존재하지 않는 기간 입력을 줄이라고 안내하지 않는다.

회귀 검증은 요청 한도 10,000, 원본 9,999건의 전체 합계, 원본 10,000건에서 부분 합계 차단을 확인한다. 운영 미인증 검증은 한도 오류가 없어졌다는 근거이며, 실제 로그인 사용자의 검색 결과 확인과는 구분한다.
