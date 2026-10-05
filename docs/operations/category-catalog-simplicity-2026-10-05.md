# 카테고리 원본과 확정 버전

## 요구사항과 설계

W8의 목록·기본값·catalogVersion은 같은 categoryCatalog/current 문서의 한 상태입니다. 서버가 실제 transaction에서 결정한 catalogVersion을 명령 결과와 receipt에 함께 저장하고, Web은 이 값을 다음 편집 가능 상태의 기준으로 사용합니다. 삭제 준비·완료 단계 수를 화면에서 추정하지 않습니다. CAT-002/003/007의 개별 version·카탈로그 version 충돌과 archive 참조 변경은 유지합니다.

기존 여섯 category Command에 optional catalogVersion 응답을 추가합니다. 생성의 categoryId는 유지하며 기존 receipt에는 필드를 채워 넣거나 현재 버전으로 결과를 바꾸지 않습니다. 새 Web에서 필드 없는 구 receipt 응답은 서버 카탈로그를 한 번 조회해 확인합니다. 새 응답은 추가 조회 없이 기존 구독이 확정 버전을 관측하면 다음 변경을 허용합니다. 서버 선행 배포 후 Web 소비자를 배포합니다.

## 서버 검증

- 카테고리 계약·실제 adapter 관련 단위 검사 3개 파일 21개 통과, Functions TypeScript 통과.
- 실제 Firestore/Storage Emulator + Admin SDK 금융 명령 통합 22개 통과.
- 여섯 명령의 응답 버전을 매번 실제 canonical 문서와 비교했습니다. 후속 변경 후 최초 명령 재전송 결과가 그대로인지, 구 receipt에 버전 필드가 없어도 같은 결과를 반환하며 저장 receipt를 바꾸지 않는지 확인했습니다.
- 로그: TEMP/household-simplicity-category-confirmation-20261005.log.

Web의 중복 구독 제거와 소비자 검증은 후속 단계입니다. 서버 응답 추가만으로 W8 전체 완료로 표시하지 않습니다.
