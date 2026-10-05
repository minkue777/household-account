# B. Firestore 저장 대역의 중첩 필드 계약

기준 SHA: `921ef881ccd84641aa711416cde7f31bfddbfabb`.

## 직접 읽은 범위

- `functions/test/integration/firebase/firestore-double-semantics.integration.test.ts` 전체.
- `functions/test/support/in-memory-firestore.ts` 전체: 문서·query·transaction·값 정규화·쓰기 경계.
- `functions/test/support/in-memory-firestore.test.ts` 전체.
- [기존 대역 교정 기록](../../operations/access-simplicity-2026-10-05.md), [실제 코드 검증 원칙](../../testing/real-code-test-cleanup.md), Functions Vitest 실행 설정.

최초 독점 대상은 첫 번째 검사 파일 한 개다. 공유 대역 두 파일은 읽기 참조이며 이번 변경 대상으로 확장하지 않았다.

## 입력·결과·실패와 유지 결정

실제 Firestore Emulator와 메모리 대역에 동일 문서를 저장하고, 다음 네 연산의 저장 결과를 비교한다.

1. `merge: true`: 기존 중첩 map의 leaf를 보존하며 새 leaf를 합친다.
2. `mergeFields: ['daily']`: 명시한 map을 교체해 이전 날짜를 제거한다.
3. transaction `update`: map 교체와 점 경로 필드 쓰기를 처리한다.
4. 빈 map과 `FieldValue.delete()`: 지정 map을 비우고 지정 leaf를 삭제하되 다른 필드는 보존한다.

SDK와 대역의 직접 결과 비교 외에 `daily` 교체 결과와 무관한 `keep` 값도 명시적으로 검사한다. 실제 SDK 없이 같은 가짜 알고리즘을 두 번 실행하는 구조가 아니다. 짧은 SDK 호출을 공통 실행 엔진으로 감싸거나 결과 상수만 검사하도록 바꾸면 관측 경계가 흐려져 기존 구조를 유지한다.

대역의 MVCC·동시 경합·보안 Rules·실제 조회 비용은 이 검사의 보장 범위가 아니다. 이를 검증하는 기존 실제 SDK 검사를 대체하지 않는다. Emulator가 없는 일반 단위 실행에서는 의도적으로 skip되므로, 아래 검증은 Emulator를 켠 실행 결과로만 완료한다.

## 코드량·검증

- 테스트 파일 39줄 유지. 제품 실행 코드 변경·감축은 없다.
- 실제 Firestore 검사 결과는 [통합 기록](README.md)에 남긴다.
