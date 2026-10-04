# 날짜별 내역의 반복 로딩 표시 제거

## 원인과 요구사항

첫 홈 코드 분리에서 `deferHomeContent`가 컴포넌트 인스턴스마다 `React.lazy`를 새로 만들었다. 날짜별 내역의 key는 가구·거래 유형·날짜이므로 날짜 변경/닫기 후 재진입마다 새 loader가 만들어졌다. 이미 다운로드한 모듈도 새 Promise의 완료를 기다리면서 로딩 문구가 다시 표시될 수 있었다.

AND-012 / T-WEBVIEW-004, SYS-008 / T-SYS-008: 첫 전체 홈 paint 이후 날짜별 내역 코드만 미리 준비하고 완료된 코드를 재사용한다. 가구·날짜별 컴포넌트 상태는 기존 key로 초기화한다. 다른 닫힌 모달은 첫 사용에만 불러오고 첫 paint의 정적 JavaScript 선행 조건으로 추가하지 않는다. 변경은 Web 코드·문서·검사이며 Web Git 자동배포 대상이다. Firebase와 APK는 재배포하지 않는다.

## 설계·계약

- 각 지연 기능의 모듈과 진행 중 Promise를 factory 범위에서 공유한다. 완료된 모듈은 다음 mount 때 동기적으로 사용하여 Suspense fallback 재노출을 방지한다. 사용자 자료나 컴포넌트 상태는 공유하지 않는다.
- 날짜별 내역의 `preload`만 `scheduleAfterWebFirstHomeCompletePaint`에 등록한다. idle deadline은 1초이며 첫 paint 전 fallback 실행은 사용하지 않는다. unmount는 아직 시작하지 않은 준비 예약을 취소한다. 수입 화면도 같은 날짜별 코드를 사용한다.
- 사전 준비와 첫 사용이 겹쳐도 실제 loader는 하나다. 준비 실패는 홈에 오류를 띄우지 않고 첫 사용에서 재요청할 수 있다. 실제 첫 사용의 실패는 기존 오류·재시도 동작을 유지하며 실패한 Promise와 React.lazy를 재사용하지 않는다.
- 사용자가 준비 완료 전에 날짜를 누르거나 다운로드가 느리면 실제 최초 로딩 표시는 남을 수 있다. 완료 후 날짜 전환의 인위적인 반복 로딩을 제거한다. 준비를 기다려 첫 홈 완료 판정을 늦추지 않는다.

## 검증·추적성

지연 UI 계약 검사에서 key 변경/닫기 후 재진입의 즉시 표시와 상태 초기화, 사전 준비 완료 후 첫 표시, 진행 중 중복 요청 방지, 준비 실패 후 첫 사용 및 사용자 재시도를 확인한다. 기존 편집 초안·실패 복구 검사를 유지한다.

실제 production WebKit + Firebase Emulator에서는 날짜별 chunk의 요청 시각이 첫 전체 홈 paint 이후인지 확인한다. 다른 미사용 chunk는 요청하지 않아야 한다. 반복 날짜 선택에서 로딩 DOM이 새로 삽입되지 않고 추가·검색·편집 및 실제 chunk 실패·재시도가 유지되는지 검사한다. 운영 금융 자료는 변경하지 않는다.

## 로컬 검증 기록

수정 전 신규 회귀 4개가 실패했고 수정 후 지연 로드·편집 초안·첫 paint 준비·스케줄링·런타임 경계 5파일 29개와 타입 검사가 통과했다. 날짜 key 변경 시 새 편집 상태를 유지하면서 동기 표시하며, 완료/진행 중 module 재사용 및 준비 실패 후 첫 사용 재요청을 확인했다. Emulator 준비의 Functions architecture 45개와 세 codebase 빌드도 통과했다. 실제 production WebKit 검사는 첫 paint 이후 chunk 요청 시각과 반복 선택 중 MutationObserver로 관측한 로딩 DOM 삽입 수, 기존 추가·검색·편집·chunk 재시도와 알림 편집 링크를 검사한다. 로그는 TEMP/household-date-detail-{before,unit,prepare,e2e}-20261004.log이며 전체 CI와 정확한 SHA의 Git 배포 상태를 후속 확인한다.
