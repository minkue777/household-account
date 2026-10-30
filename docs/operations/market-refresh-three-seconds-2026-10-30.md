# 자산 갱신 3초 목표의 추가 최적화

## 기준과 목표

사용자가 전체 자산 갱신의 체감 지연이 줄지 않았다고 보고했고 정상 갱신을 3초 이하로 줄이는 것이 목표다. 이전 분석·실패 이력은 [10월 29일 기록](market-refresh-performance-2026-10-29.md)을 유지한다.

익태송희네의 이전 전체 갱신 세 건은 서버 내부 total 5,525~8,784ms(평균 6,857ms), handler 평균 6,604ms였다. 조회 최적화 직후 rev75의 첫 호출은 total 7,306ms, handler 5,686ms, 공통 명령 receipt 확보 1,523ms였다. 해당 호출은 30개 대상 중 29개 갱신·1개 마지막 성공 시세 보존이며, warm 호출과 cold 호출을 동일 조건의 전후 비교로 취급하지 않는다. rev76 배포 이후 2026-10-30 09:44 KST까지 조회한 갱신 로그는 없었다.

3초는 정상 운영의 목표이며, 외부 공급자의 기존 10초 timeout·3회 시도를 단축해서 달성하지 않는다. 로컬 공개 시세 GET 표본과 Emulator 실행시간은 운영 전체 갱신 성능의 증거가 아니다.

## 변경

- `JOB-AST-001`, `HOLD-003`, `HOLD-004`: 임대 확보의 receipt·lock·cooldown 문서를 `getAll`로 한 번에 읽는다. 설치된 Firestore SDK는 기본 쓰기 transaction의 첫 읽기로 transaction ID를 확보한 뒤 나머지 읽기를 시작하므로 이전 `Promise.all(get, get, get)`의 추가 왕복을 제거한다.
- 최초 상태 조회는 `readOnly: true` transaction을 사용한다. 일관된 최신 snapshot은 유지하고 빈 commit과 불필요한 읽기 잠금을 제거한다. 저장 전 Asset·Position version 검사와 최종 원자 transaction은 유지한다.
- 미국 주식의 가격과 환율 관측 저장을 병렬 시작한다. 두 작업 모두 완료·실패 정리한 뒤 반환하며 한쪽 성공 관측은 다른 쪽 실패에도 보존한다. 가격 HTTP가 준비된 뒤 durable FX를 선택하고 다른 instance의 최신 관측을 우선하는 계약을 유지한다.
- 보유종목의 `instrumentType`을 내부 시세 target에 전달한다. 미국 ETF는 Nasdaq `etf`부터 조회하고 실패하면 `stocks`를 조회한다. 일반 주식·분류 없는 기존 종목은 `stocks`→`etf` 순서를 유지한다. 가격의 새 TTL cache는 추가하지 않는다.
- `executeHouseholdCommand`만 256MB에서 1GB로 상향한다. [1세대 공식 배분](https://firebase.google.com/docs/functions/1st-gen/manage-functions-1st)은 CPU 400MHz→1.4GHz다. 같은 함수의 다른 명령에도 적용되며 최소 상주 instance는 추가하지 않는다. 같은 실행시간의 연산 단가는 높아지고 실제 총비용은 실행시간에 따라 달라진다.
- bootstrap에서 임대 확보, 상태 읽기, 시세 한 번, 자산 저장, 공급자 상태 저장, 임대 해제 시간을 기존 correlation/operation에 기록한다. 종목·금액·가구 식별자는 상세 로그에 추가하지 않는다. 병렬 구간을 단순 합산하지 않으며 관리자 통계는 기존 `total`만 사용한다. 단계의 succeeded는 Promise 정상 반환을 뜻하고 업무 결과 성공과는 구별한다.

Provider 동시성 5, 부분 실패의 마지막 시세 보존, 재전송 receipt, 쿨다운, version 충돌, Outbox 원자성, 자산·관측 저장 완료 전 lease 유지 계약을 보존한다. 운영 금융 데이터를 성능 측정용으로 수정하지 않는다.

## 검증·배포

- 저장소 관련 단위 4파일 54개, 시세 어댑터 관련 4파일 45개, 관리자 명령·관측·등록 경로 3파일 18개 통과(검사 묶음 간 중복 가능).
- 실제 Firestore Emulator의 시세 갱신·snapshot projection 2파일 7개 통과. 재전송·version 충돌·사용자 데이터 보존·Health 완료 전 임대 유지·snapshot 멱등성을 확인했다.
- TypeScript 검사와 architecture 43개, production Functions build 통과. 빌드 산출물의 실제 endpoint 설정도 `availableMemoryMb: 1024`, `asia-northeast3`로 확인했다.
- source/rate의 독립 저장 병렬 검사는 제어된 지연에서 170→150ms이며 실패 때도 반대쪽 저장을 끝까지 기다리는 두 방향을 검사한다. 이 수치는 운영 전체 개선율이 아니다.

세 Firebase codebase를 기존 wrapper로 배포한다. Web·APK 실행 코드 변경은 없다. 배포 뒤 자연 발생한 전체 갱신의 total과 세부 단계, 대상 수, 첫 호출 여부를 비교하여 3초 달성 여부를 판정한다. 아직 실제 운영에서 3초 이하 달성을 확인하지 않았다.
