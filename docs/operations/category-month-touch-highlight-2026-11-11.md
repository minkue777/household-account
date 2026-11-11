# 카테고리 월별 상세의 터치 강조 잔류

## 증상과 계약

Android 브라우저에서 지출 통계의 카테고리 상세를 열고 월을 펼쳤다가 접으면 해당 월 배경이 진하게 남습니다. 일반 가구와 관리자 조회가 같은 `CategoryExpenseModal`을 사용합니다.

- 월별 합계·거래를 펼치고 접는 기존 `STAT-004`·`T-STAT-005` 계약을 유지합니다.
- 터치를 끝낸 월은 다른 접힌 월과 같은 배경을 표시합니다. 마우스 hover와 키보드 초점·Enter 조작은 유지합니다.
- 조회·저장·권한·금액 계산은 변경하지 않습니다.

## 원인과 변경

월 헤더는 펼침 상태에 따른 배경 분기를 두지 않지만 `hover:bg-slate-100`을 모든 입력 장치에 적용합니다. 터치 브라우저가 마지막으로 누른 요소의 `:hover`를 유지하면 월을 접은 뒤에도 강조색이 남습니다.

월 헤더의 hover 색상만 `(hover: hover)` 미디어 조건 안에서 적용합니다. 클릭 후 강제 blur나 별도 선택 상태를 추가하지 않습니다.

## 검증과 배포

`finance-search-statistics.spec.ts`에 실제 브라우저 터치로 펼침·접기 후 계산된 배경색을 비교하는 회귀 검사를 추가했습니다. 기존 월별 상세 E2E에는 마우스 hover·이탈, 키보드 초점 표시와 Enter 펼침·접기 검사를 추가했습니다.

- 수정 전 production build·Chromium 터치 검사에서 재현했습니다. `aria-expanded=false`인데도 기본색 `rgb(248, 250, 252)` 대신 hover 색 `rgb(241, 245, 249)`가 30초 이상 유지돼 검사가 실패했습니다.
- 통계 화면 Jest 25개가 통과했습니다. 초기 로컬 Jest 실행은 동시 Next build의 `.next/types/package.json` 교체와 경합하여 실행 전 실패했고, build 완료 후 분리 실행했습니다.
- 수정 후 production build·실제 Emulator SDK를 사용한 Chromium E2E 2개가 통과했습니다. 터치 펼침·접기 뒤 기본 배경 유지, PC hover·이탈, 키보드 초점·Enter 및 기존 기간·월별 합계를 확인했습니다.
- 추가 TypeScript 검사에서 기존 `admin-portfolio.spec.ts`의 Firestore fixture `deviceInfo`가 `unknown`인 오류를 발견했습니다. 앞에서 등록한 fixture의 앱 버전 구조를 타입으로 명시했으며 런타임과 검증 조건은 동일합니다. 수정 후 `tsc --noEmit`이 통과했습니다.
- Web Git 배포 결과를 확인 중입니다. Firebase·APK 변경은 없습니다.

재현 로그·trace·화면: `%TEMP%/household-category-month-touch-before-20261111*`.
