# 서버 권위형 런타임 전환 상태

> 기준일: 2026-07-22  
> 목표 설계: [목표 Clean Architecture](target-clean-architecture.md)  
> 원칙: 로컬 구현 완료, 운영 배포, 운영 데이터 전환을 서로 다른 상태로 추적한다.

## 1. 현재 상태

| 작업 흐름 | 로컬 소스 상태 | 남은 운영 조건 |
|---|---|---|
| 목표 계약·코어 | 완료 | 없음 |
| 공통 Command·Query wire | 완료 | 배포 후 실제 앱 smoke test |
| Functions 런타임 | 완료 | Functions 배포와 외부 secret·권한 설정 |
| Web 런타임 | 완료 | Web 배포와 App Check site key 설정 |
| Android 런타임 | 완료 | OAuth 설정 갱신, App Check 등록, APK 배포 |
| Firestore·Storage 보안 | 완료 | Rules·index·TTL 설정 배포 |
| Legacy → Canonical 전환 도구 | 완료 | 가구별 dry-run 검토와 별도 승인된 apply |
| 로컬 release gate | 완료 | 운영 환경 smoke·관측 확인 |

현재 Web과 Android의 Canonical Firestore 직접 쓰기는 0건이며 변경 명령은 인증된 Functions 경계로 수렴한다. Firestore read는 Membership 기반 Rules가 보호하고, 비가구 시장 카탈로그만 Cloud Storage의 공개 읽기 경계로 분리한다.

## 2. 완료된 구조 전환

- `functions/src/index.ts`는 Context별 bootstrap과 Firebase Adapter가 조립된 실제 callable·HTTP·scheduled entry point를 export한다.
- Access가 Google 인증, Membership, `ActorContext`, `systemAdmin` capability를 소유한다. 관리자 이메일이나 클라이언트 payload는 권한 근거가 아니다.
- Web·Android·Shortcut은 공유 wire 계약을 사용하고 Ledger·Category·Recurring·Portfolio·Notifications의 변경을 서버 Command로 보낸다.
- Android 결제 수집은 등록 package의 `AndroidRawNotification.v1`만 Keystore 암호화 Queue로 보내고, Functions가 서버 Source Registry와 단일 TypeScript parser로 내부 Capture 후보를 만든다. 전환 전 `CaptureEnvelope.v1` Queue는 레거시 callable로 계속 전달한다.
- Portfolio의 자산, Position, 자동화 계획, 평가, 시세 갱신은 독립 Application으로 분리되고 얇은 facade에서만 조립된다. Firebase Adapter도 state loader, mapper, encoder, mutation writer, refresh lease로 나뉜다.
- Firestore Rules는 일반 클라이언트 쓰기를 막고 활성 Membership 기반 읽기만 허용한다. Storage Rules는 시장 카탈로그 읽기만 공개하고 모든 클라이언트 쓰기를 막는다.
- 운영 migration은 배포 Functions에 노출하지 않고 별도 CLI에서만 실행한다. source drift, target 충돌, 미해결 명의·creator가 있으면 추정하거나 덮어쓰지 않는다.
- terminal receipt·알림·예약 작업 기록 16개 collection group은 `Timestamp` TTL을 사용한다. 미해결 장애와 영구 보존 업무 이력에는 TTL을 넣지 않는다.

## 3. 검증 근거

- Functions: 246개 테스트 파일, 2,322개 테스트 통과; 타입 검사, 아키텍처 33개, 런타임 경계 위반 0건, 빌드 통과
- Firebase Emulator: Firestore Rules 7개, Storage Rules 3개, Firebase Adapter·migration·TTL 통합 36개 통과
- Web: 7개 suite, 28개 테스트와 Next.js production build 통과
- Android: 단위 테스트 29개와 Debug APK 조립 통과

일반 `npm test`에서 비실행되는 항목은 Emulator 환경에서 별도로 실행하는 통합 suite와 교체 전 PWA 동작을 기록한 의도적 legacy characterization뿐이다. 제품 결정을 기다리는 `test.todo`는 없다.

## 4. 운영에서만 남은 작업

아래 항목은 로컬 코드가 임의로 수행할 수 없으며, 이 문서는 실행 승인이 아니다.

1. [배포 전 외부 설정 체크리스트](../operations/deployment-prerequisites.md)에 따라 Android OAuth, Web·Android App Check, Shortcut secret, `systemAdmin` claim, Cloud Monitoring 이메일 channel을 설정한다.
2. Functions, Firestore Rules·index·TTL, Storage Rules, Web, Android를 승인된 순서로 배포한다.
3. [런타임 데이터 전환 Runbook](../operations/runtime-migration-runbook.md)의 가구별 dry-run을 검토한 뒤 별도 승인된 plan만 적용한다.
4. [Firestore TTL 전환 Runbook](../operations/firestore-ttl-backfill.md)의 dry-run과 plan hash를 검토한 뒤 별도 승인된 백필만 적용한다.
5. reconciliation이 `MATCH`인 가구만 compatibility reader 제거 후보로 분류한다. legacy 원본 삭제와 영구 purge는 자동 수행하지 않는다.

## 5. 역사적 시작 상태

전환 전에는 flat Functions handler, Web·Android 직접 Firestore writer, 공개 Rules, 테스트 전용 참조 구현이 혼재했다. 이 목록은 현재 상태가 아니라 리팩토링의 출발점이며, 상세 근거와 단계는 [Clean Architecture 리팩토링 전략](clean-architecture-refactoring-strategy.md)에 보존한다.
