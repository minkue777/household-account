# 카테고리 원본과 확정 버전

## 요구사항과 설계

W8의 목록·기본값·catalogVersion은 같은 categoryCatalog/current 문서의 한 상태입니다. 서버가 실제 transaction에서 결정한 catalogVersion을 명령 결과와 receipt에 함께 저장하고, Web은 이 값을 다음 편집 가능 상태의 기준으로 사용합니다. 삭제 준비·완료 단계 수를 화면에서 추정하지 않습니다. CAT-002/003/007의 개별 version·카탈로그 version 충돌과 archive 참조 변경은 유지합니다.

기존 여섯 category Command에 optional catalogVersion 응답을 추가합니다. 생성의 categoryId는 유지하며 기존 receipt에는 필드를 채워 넣거나 현재 버전으로 결과를 바꾸지 않습니다. 새 Web에서 필드 없는 구 receipt 응답은 서버 카탈로그를 한 번 조회해 확인합니다. 새 응답은 추가 조회 없이 기존 구독이 확정 버전을 관측하면 다음 변경을 허용합니다. 서버 선행 배포 후 Web 소비자를 배포합니다.

## 서버 검증

- 카테고리 계약·실제 adapter 관련 단위 검사 3개 파일 21개 통과, Functions TypeScript 통과.
- 실제 Firestore/Storage Emulator + Admin SDK 금융 명령 통합 22개 통과.
- 여섯 명령의 응답 버전을 매번 실제 canonical 문서와 비교했습니다. 후속 변경 후 최초 명령 재전송 결과가 그대로인지, 구 receipt에 버전 필드가 없어도 같은 결과를 반환하며 저장 receipt를 바꾸지 않는지 확인했습니다.
- 로그: TEMP/household-simplicity-category-confirmation-20261005.log.

## Web 소비자와 검증

CategoryProvider가 목록·기본값·버전을 한 DTO로 구독합니다. CategorySettings의 별도 구독, 기본값 복제 state, 삭제 단계 수 추정을 제거했습니다. 명령이 반환한 실제 버전 이상을 Provider가 받으면 다음 편집을 허용합니다. 실패는 편집 초안을 보존하고 가구 교체는 별도 편집 인스턴스입니다. 세션 재검증 중에는 변경을 허용하지 않습니다.

- 카탈로그 Provider·명령 소비·화면·초기 조회 Jest 4개 파일 28개 및 후속 삭제 완료 버전 검사 통과(총 29개). TypeScript 통과.
- 실제 Emulator/production build/Chromium 카테고리 E2E 5개 통과: 모바일 연속 touch 순서, 추가·편집·삭제·기본값·새로고침·서버 거부.
- 로그: TEMP/household-simplicity-category-e2e-{prepare-,}20261005.log.

## 배포

서버 d2b6a9ca44623b5b86a0e0493eb5b4f4a0dfdff4를 release-20261005-simplicity-category-d2b6a9c로 세 codebase에 배포했습니다. 앞선 46d97e4의 명령 등록 정책도 포함됩니다. 실제 로그인 Query smoke와 provenance 기록 성공, artifact SHA256 be9acd234b67613872f6b281f14d2ebd8478eb83f45daf4c22ce24886e76cdeb. 이전 46d97e4 전체 CI도 성공했습니다. Web은 후속 Git 자동배포로 추적합니다.
