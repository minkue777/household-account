# Quick Edit 카테고리 ID 보존

## 원인과 수정

Quick Edit은 서버 snapshot의 `categoryId`를 Intent로 그대로 받지만, 화면을 열 때 `lowercase()`를 적용했습니다. 대소문자가 섞인 사용자 카테고리는 목록의 원래 ID와 일치하지 않아 선택 표시가 사라졌습니다. 같은 값이 분할 초안에도 사용되었습니다.

카테고리 ID는 모든 종류에서 대소문자를 구분하는 식별자로 취급합니다. `QuickEditActivity`의 소문자 변환, `CategoryRepository.findCategoryByKey`의 소문자 대체 조회, `buildQuickEditUpdatePatch`의 대소문자 무시 비교를 제거했습니다. 새 ID만 예외로 처리하는 분기는 추가하지 않았습니다. 기존 ID와 거래·규칙의 참조는 변경하지 않습니다.

현재 호출자는 서버가 확정한 snapshot의 ID를 전달합니다. 이전 데이터의 기본 enum을 해석하는 Web·Functions의 저장 데이터 호환 계약은 별도이며, Quick Edit에서 중복 해석하지 않습니다. Android 테스트의 기본 Intent도 실제 호출처럼 `food`를 사용합니다.

관련 요구사항: [QE-002, QE-009, QE-010, QE-012](../requirements/supporting-platform/modules/android-host/requirements.md).

## 검증 범위

- 단위 테스트: 기본 ID의 변경 없음, 사용자 카테고리에서 메모만 수정, 대소문자가 다른 ID로 실제 변경.
- Android instrumentation: 대소문자만 다른 두 항목 중 정확한 선택 표시, 메모만 담긴 암호화 저장 명령, 분할 초안과 항목의 ID 보존, 정확한 repository 조회.
- UI 검증은 테스트 카테고리 목록을 Activity에 주입하고 실제 Intent 처리·버튼 생성·선택·명령 저장을 실행합니다. 운영 Firestore 조회나 실제 결제 수집을 결합한 검증은 아닙니다.
- 필수 실행: Functions `test:quality-gate`, Android `testDebugUnitTest lintDebug assembleDebug assembleRelease connectedDebugAndroidTest`.

2026-09-11 로컬 검증 결과: Functions 활성 322개 suite·2,857개 테스트 및 타입·런타임 경계·빌드 통과. Android 단위 116개, API 36.1 에뮬레이터 instrumentation 20개 모두 실패·오류·생략 0건이며 lint·Debug/Release 빌드도 통과했습니다.

Android 네이티브 수정이므로 사용 중인 앱에는 새 APK 업데이트가 필요합니다.
