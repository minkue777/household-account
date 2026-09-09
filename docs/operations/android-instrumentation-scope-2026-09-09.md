# Android 에뮬레이터 검증 범위

사용자 요청에 따라 Web 표시만 바뀐 경우 Android 에뮬레이터 검증을 의무로 요구하지 않는다.

- 자동 실행 대상: `android/**`, `contracts/**`, `web/src/platform/android-host/**`, Android bridge·인증·Firebase 연결 파일. 경로 판정은 [실행 스크립트](../../tools/ci/android-instrumentation-scope.mjs) 한 곳에서 관리한다.
- Web 글자·색상·레이아웃·카테고리 UI 변경은 에뮬레이터 대상이 아니다. 관련 Web 테스트·빌드·모바일 브라우저 검증은 유지한다.
- `android-instrumentation` job은 먼저 변경 범위를 확인한다. 관련 변경이 없으면 이를 summary에 기록하고 성공 종료하며, SDK 준비·APK 빌드·에뮬레이터 부팅·계측 테스트를 실행하지 않는다. 이 성공은 계측 테스트를 실행해 통과했다는 뜻이 아니다.
- 관련 변경이 있으면 기존 18개 계측 테스트를 그대로 실행한다. 비교 범위를 확인하지 못한 경우도 성공으로 처리하지 않는다. 다른 네 job과 Firebase 배포 wrapper의 정확한 HEAD 확인은 유지한다.
- 여러 커밋을 함께 push하면 전체 push 범위를 비교하고, PR은 공통 조상을 기준으로 비교한다. 삭제·이름 변경된 Android 경로도 검사한다.
- Android 에뮬레이터 실행 환경 자체를 확인해야 하는 경우 GitHub Actions 수동 실행은 전체 검증을 수행한다. 일반 Web 표시 수정에 수동 실행을 추가로 요구하지 않는다.

2026-09-09의 글자 복원 커밋 `3c4f064`에서 첫 Android job은 약 5분이 걸렸으나 실제 18개 테스트 실행은 약 45초였다. 첫 실패는 Pixel Launcher 응답 없음 창이 화면 포커스를 가린 상태였고, 두 번째 실행에서도 Launcher ANR과 테스트 프로세스 종료가 발생했다. 이번 변경은 실행 대상 정책을 수정하며, 기존 실패를 통과로 바꾸거나 테스트 assertion을 제거하지 않는다.

GitHub의 [단계별 조건 실행](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsif)을 사용한다.
