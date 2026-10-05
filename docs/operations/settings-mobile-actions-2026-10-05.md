# 모바일 설정의 수정 버튼 잘림

## 원인과 변경

`263e78c4`에서 저장 중 중복 입력을 막기 위해 가맹점 규칙과 정기 지출에 추가한 `fieldset`의 기본 최소 폭이 내용 최소 폭으로 계산됐습니다. 긴 OR 키워드나 메모가 있으면 묶음 전체가 카드보다 커지고, 카드의 `overflow-hidden`이 오른쪽 수정·삭제·우선순위 버튼을 잘랐습니다. 버튼과 저장 기능은 있었지만 화면에서 접근할 수 없었습니다.

두 설정의 `fieldset`에 `min-w-0`을 지정해 부모 카드 폭 안에 배치합니다. 기존 텍스트 말줄임·버튼 고정 폭·저장 중 입력 잠금은 유지합니다. 실행 코드 변경은 두 줄이며 저장 명령과 서버 계약은 변경하지 않습니다.

## 계약과 회귀 검사

- [가맹점 규칙 설계](../requirements/contexts/payment-capture/modules/payment-configuration/design.md): MER-003/004. 기존 `payment-configuration.spec.ts`의 실제 수정·우선순위·수집 반영·새로고침·삭제 검사에 393px 화면과 긴 OR 키워드를 넣고 모든 버튼이 완전히 보이는지 확인합니다.
- [정기 지출 설계](../requirements/contexts/household-finance/modules/recurring-transactions/design.md): REC-001/006. 기존 `finance-currency-recurring.spec.ts`에 같은 화면 폭과 긴 메모를 넣고 수정·삭제·활성 버튼 노출, 생성·수정·활성 전환·최초 등록자 보존·재조회·삭제를 확인합니다.

수정 전 production build와 실제 Auth/Functions/Firestore Emulator를 사용하는 가맹점 Chromium 검사는 1 failed였습니다. 긴 키워드 규칙의 수정 버튼이 DOM에 존재하지만 화면 노출 비율이 0이었고, 실패 스크린샷에서 짧은 규칙을 포함한 전체 버튼 영역이 카드 오른쪽에서 잘리는 현상을 확인했습니다. 로그와 trace·스크린샷은 `TEMP/household-merchant-mobile-red-20261005.log`, `TEMP/household-merchant-mobile-red-artifact-20261005`에 보존했습니다.

수정 후 같은 production build·Emulator 경로의 가맹점 규칙 및 정기 지출 Chromium 검사 2개가 통과했습니다(33.9초). 버튼의 완전한 화면 노출뿐 아니라 실제 수정·재조회·삭제와 수집 반영을 확인했습니다. E2E 준비의 architecture 43개, 문서 링크·추적성 13개와 요구사항 248개 catalog/E2E 연결 검사도 통과했습니다. 실행 초기에 Windows 명령 인자의 따옴표·파이프 검증이 복수 테스트 선택식을 거부하여, 같은 두 테스트를 선택하는 문자 클래스로 실행 인자만 변경했습니다. 테스트나 시간 기준은 완화하지 않았습니다. 로그는 `TEMP/household-merchant-mobile-{prepare,green,docs}-20261005.log`이며 로컬 Emulator는 정상 종료했습니다.

## 배포 범위

Web 변경으로 Vercel Git 자동배포만 수행합니다. Firebase·APK 배포와 운영 데이터 변경은 없습니다. 전체 CI는 최종 커밋으로 후속 확인합니다.

## 순서 변경 기능 제거

첫 수정은 버튼의 잘림만 해결했습니다. 이후 사용자 화면에서 화살표 두 개가 가맹점명·설명 폭을 과하게 차지하는 문제가 확인됐습니다. 버튼의 완전 노출만으로 내용 가독성까지 보장했다고 판단한 검증 누락입니다. 사용자 요청에 따라 목록은 원래의 수정·삭제 두 버튼으로 복원하고 순서 변경 기능을 제거합니다. 별도 순서 변경 모드를 추가하지 않습니다.

화면의 이동 핸들러·진행/오류 상태, 서비스·Application의 재정렬 호출과 조회 모델의 collection version을 제거합니다. 그 version을 얻기 위한 metadata 구독과 두 구독 결과를 합쳐 기다리는 로직도 제거합니다. 규칙 문서의 version·비활성 값·mapping 변환, 구독 오류와 종료 후 늦은 응답 차단은 유지합니다. 기존 서버의 자동 분류·priority 값과 구형 클라이언트 프로토콜은 유지하므로 Firebase·APK 재배포와 운영 데이터 변경은 없습니다.

삭제한 기능의 UI 검사는 수정·삭제만 제공하는 계약으로 바꾸고 테스트 파일을 `merchantRuleSettings.contract.test.tsx`로 정리했습니다. 브라우저 검사는 360px·393px에서 `지에스더프레시`와 매핑 설명이 말줄임 없이 읽히는지 확인하고 두 화면의 스크린샷을 남깁니다. 긴 OR 키워드, 실제 수정·재조회·삭제·후속 수집 결과와 저장된 priority 보존 검사도 유지합니다.

관련 Jest 2개 파일 7개, 문서 링크·추적성 13개, catalog/E2E 연결 검사가 통과했습니다. Production build와 실제 Auth/Functions/Firestore Emulator를 사용한 Chromium 시나리오도 1 passed(30.7초)이며, 두 화면의 스크린샷을 직접 확인했습니다. 실행 코드 4개 파일은 순감 46줄입니다. 로그는 `TEMP/household-merchant-actions-{unit,e2e,docs}-20261005.log`입니다. 로컬 Emulator는 정상 종료했습니다.

직전 `7108b151`의 [CI 37314292723](https://github.com/minkue777/household-account/actions/runs/37314292723)는 네 검사 성공, web-e2e 101 passed/1 failed와 요약 실패입니다. 가맹점·정기지출 검사는 통과했고, 실패한 `notifications.spec.ts:156`의 PUSH-012는 업무 검사 전 가구 준비 중 Auth Emulator의 `accounts:signInWithPassword` POST가 `socket hang up`으로 끊겼습니다(`emulator.ts:191`). 관측된 실패 경계는 테스트 인증 환경이며 연결이 끊긴 내부 원인은 미확정입니다. 이 현상을 제품 결함 수정으로 보고하거나 재시도·시간 완화로 덮지 않습니다. 로그는 `TEMP/household-merchant-mobile-ci-37314292723.log`에 보존하고 이번 제품 변경의 전체 CI에서 같은 검사를 후속 확인합니다.
