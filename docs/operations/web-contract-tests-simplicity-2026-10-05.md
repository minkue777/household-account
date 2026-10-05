# 운영 연결과 Web 계약 검사 정비

## 범위와 계약

W6/WT-03: 운영에서 사용하지 않는 HomePreferencesSettings와 그 전용 Command wrapper·유형 선택 hook·테스트를 제거했습니다. HOME-001의 현재 제공 범위(저장 구성 조회)를 유지하고 HOME-004의 향후 편집 UI는 구현 완료로 보고하지 않습니다. 실제 useHomePreferences를 통한 canonical version, 기존 중복 구성, 기본값, 공유 구독, 가구 전환 후 늦은 응답 격리를 검증합니다. 실제 Emulator E2E의 서버 저장·충돌·재전송·새로고침 검사는 유지합니다. 이는 홈 설정의 간헐적 live-read 실패를 해결했다는 의미가 아닙니다.

WT-01: optimistic projection의 내부 current 호출 횟수 assertion을 제거했습니다. command metadata·expectedVersion·즉시 반영·실패 rollback·분할의 결과 검사는 유지합니다.

WT-02: 미사용 deleteExpense 인자는 앞선 settings-simplicity 정비에서 호출부까지 제거됐습니다. 상세 선택·월 분할 결과 검사는 유지합니다.

WT-04/05: endpoint 등록 중간 상태의 반복 횟수 대신 단계 순서를 검증합니다. 각 테스트마다 runtime module과 callback을 초기화하고 malformed payload·actor 교체 검사는 스스로 등록한 뒤 유효 payload의 positive control을 확인합니다. callback이 없어서 부작용이 없었다고 통과할 수 없도록 존재 assertion 후 직접 호출합니다.

WE01: CategorySelector의 선택 상태를 aria-pressed로 표현하고 Native→Web E2E도 그 사용자 상태를 검사합니다. 특정 border 클래스와 검사를 묶지 않습니다. 사용처 없는 세 UI barrel도 제거했습니다.

## 검증

- 홈 조회·설정 버전·초기 조회 관련 Jest 3개 파일 35개 통과.
- endpoint 수명·원장 optimistic·상세 선택 Jest 3개 파일 52개 통과.
- actor 변경 후 늦은 callback 검사 단독 실행 통과. 테스트 순서에 의존하지 않습니다.
- Web TypeScript 검사 통과.
- 실제 Native→Web E2E는 후속 CI 대상입니다. 이 변경만으로 로컬 Native 검사를 수행했다고 보고하지 않습니다.
