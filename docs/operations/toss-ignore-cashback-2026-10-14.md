# 토스 캐시백 무시와 결제금액 기록

## 요구사항과 변경

사용자 요청에 따라 토스 승인에서 캐시백을 차감하지 않는다. 10,000원 결제·500원 캐시백 알림은 원장과 QuickEdit에 10,000원으로 기록한다. PARSE-TOSS-001과 DEC-076을 적용한다.

- 입력: 기존 토스 체크카드·페이스페이 알림. 결제금액과 가맹점의 기존 해석을 사용한다.
- 결과: 승인·취소 모두 결제금액을 사용한다. 캐시백 추출 정규식과 차감·0원 제한 계산을 제거한다. 캐시백 단독 알림은 거래를 만들지 않는다.
- 실패: 가승인 제외, 형식·금액 검증, 미등록 카드와 권한 처리는 유지한다.
- 저장: 기존 원장·Capture·QuickEdit 경로를 사용한다. 취소의 불변 승인 총액 증거를 유지하며 과거 순액 기록과 receipt를 변경하지 않는다. 같은 원문의 재전송은 최초 결과를 재생하고 원문이 달라지면 충돌로 거부한다.
- 범위: 서버 parser만 변경한다. 기존 운영 거래 일괄 수정, Web·APK 변경은 없다. 세 Firebase Functions codebase가 같은 서버 코드를 포함하므로 배포 대상이다. 공개 wire/schema 버전은 변경하지 않는다.

## 검증과 추적성

| 계약 | 검증 | 결과 |
|---|---|---|
| PARSE-TOSS-001 / T-PARSE-001·002 | 공개 parser golden: 체크카드·페이스페이, 캐시백 초과·overflow·단독, 취소·가승인 | 전체 ParseResult 확인 |
| PARSE-TOSS-001 / ING-008 / CAN-003 | raw→실제 Application→Firebase Adapter: 원장·Capture·QuickEdit, 재전송, 캐시백만 바뀐 원문 거부, 과거 순액 receipt 재생·총액 취소 | 기존 저장·멱등성 보존 |
| T-CAN-LINEAGE-001 / T-CAN-006 | 실제 Firestore Emulator에서 raw 입력 저장 후 금액·가맹점 수정 및 월 분할, 총액 취소·재전송 | 원본·파생 삭제와 총액 증거 보존 |

- 구현 변경 전 새 기대값은 5개 실패했고, 변경 후 관련 3개 파일의 134개 검사가 통과했다.
- Functions 타입 검사와 실제 Firestore 대상 검사 3개가 통과했다. 다른 22개는 명시한 `-t PARSE-TOSS-001` 범위 밖이며 전체 검증은 CI에서 수행한다. Emulator는 정상 종료했다.
- 요구사항 catalog/E2E 추적성 생성 결과 누락은 0개다.
- 로컬 로그: `TEMP/household-toss-cashback-{before,unit,types,firebase}-20261014.log`.

배포 후보의 정확한 SHA와 release marker는 Firebase wrapper의 provenance로 검증하며 CI는 독립 실행한다.

## 배포 결과

- 구현 `db131ee661574c903e0a6f54381b7b2ba50bf48d`를 push했고 [CI 38515812333](https://github.com/minkue777/household-account/actions/runs/38515812333)를 추적한다.
- clean HEAD에서 배포 계획은 Functions 세 codebase를 선택했다. production build·architecture 43개 검사·artifact hash 계산을 마쳤다.
- 처음에는 브라우저 연결이 없어 로그인 확인을 진행하지 못했다. 연결이 복구된 뒤 내장 브라우저에서 고정 로그인 주소를 열었고 저장된 Google 로그인이 자동 복원됐다. 완료 화면과 저장소 밖 token 파일 생성을 확인했다. 휴대폰에서 localhost를 열거나 다시 로그인할 필요는 없었다.
- 후속 Web 변경을 포함한 clean HEAD `34f57a8ab8b736ffee8129e4c35e67dba6d0c118`에서 hash·manifest를 다시 준비했다. `release-20261014-toss-cashback-34f57a8`의 세 Functions codebase 배포, 실제 사용자 해석·가구 Query·동일 SHA/artifact marker 검증 및 성공 provenance 기록을 완료했다. artifact SHA256은 `100d353a4559998f944af1d63a6e7e1cfffbc9d789bff64dc03a522fa8fe16fe`다.
- 배포 로그: `TEMP/household-toss-cashback-deploy-20261014.log`. 사용자 원장 데이터는 직접 보정하지 않았다. 토스 구현의 CI `38515812333`은 실제 Android 검사를 포함한 다섯 검사와 CI 결과 요약이 모두 성공했다. 후속 Web·스킬 변경의 전체 CI 결과는 별도로 추적한다.
