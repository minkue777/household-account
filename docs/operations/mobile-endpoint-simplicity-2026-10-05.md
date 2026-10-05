# 설치별 알림 등록 명령 정비

## 계약과 변경

Capture 조사 4번을 처리했습니다. 인증된 서버 요청마다 가상의 세션을 복원하고 OS 권한을 `granted`로 설정하던 controller를 제거했습니다. 서버는 해당 요청의 검증된 가구·멤버 binding으로 설치 등록·해제·로그아웃 명령을 실행합니다. 실제 PWA/Android의 로그인 수명, 지원 환경과 OS 권한 검사는 클라이언트가 소유합니다.

설치 ID 해시, metadata allowlist, 등록 버전, binding 버전과 Firestore transaction은 유지합니다. 재등록은 같은 설치를 갱신하고 inactive TTL을 지웁니다. 다른 가구로 재등록된 설치는 이전 actor의 늦은 삭제로 제거되지 않습니다. SDK 해제는 같은 binding과 등록 버전이 모두 일치해야 합니다. 로그아웃은 해당 설치 하나만 제거합니다. wire DTO와 인증 router는 바꾸지 않습니다.

## 검증

- 실제 household handler를 실행하는 Functions 관련 3개 파일 34개 통과. 입력 거부, 두 platform, 설치별 독립성, 재등록, 해제와 actor 변경을 확인했습니다.
- 실제 Admin SDK/Firestore Emulator에서 같은 설치를 서로 다른 actor가 동시에 등록해 버전 1·2로 직렬화됨을 확인했습니다. 낡은 actor/버전의 해제 거부, inactive TTL, 재등록 때 TTL 삭제, 다른 설치 보존까지 1개 통합 검사 통과.
- 실제 PWA lifecycle의 데스크톱·권한 거부·로그인 전 등록 차단을 보강했습니다. 해당 파일 26개 통과.
- Functions 테스트 TypeScript 검사 통과.

통합 로그: `TEMP/household-simplicity-fid-sdk-20261005.log`. 서버 변경은 세 codebase 배포 대상이고 Web/Android 실행 코드는 변경하지 않았습니다. 배포 완료 여부는 후속 배포 기록으로 구분합니다.
