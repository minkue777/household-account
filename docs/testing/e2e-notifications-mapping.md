# 알림의 실제 실행 경로와 검증 경계

`web/e2e/notifications.spec.ts`는 실제 Auth Emulator 계정과 운영 callable로 가구·가입·카드·endpoint·거래를 만들고, 운영 Firestore Outbox trigger가 실행한 대상 선정·delivery claim·Firebase Adapter의 결과를 읽습니다. 최초 명시 요청은 실제 지출 수정 화면의 **알림 보내기** 버튼에서 시작합니다. 참조 모델, 가짜 Command 응답, 가짜 Repository를 사용하지 않습니다.

FCM에는 Emulator가 없어 `tools/e2e/firebase-fcm-transport.cjs`가 Firebase Admin `Messaging.send` 외부 전송만 대신합니다. 고정 demo 프로젝트·127.0.0.1 Firestore Emulator·명시 환경 변수를 모두 검증하며 다른 환경에서는 실패합니다. 전송 메시지와 호출 시각을 관측하고 성공·현재 UNREGISTERED·timeout·quota·credential·network 및 늦은 UNREGISTERED 응답을 제공합니다. 이것은 **FCM 접수 경계까지의 자동 검증**이며 iPhone의 APNs 전달이나 실제 기기 알림 표시를 입증하지 않습니다.

| 요구사항 | 실행 파일과 실제 assertion | 남는 경계 |
|---|---|---|
| PUSH-001 | `notifications.spec.ts`의 인증된 FID 등록 시나리오: 지원 platform 저장, desktop 거부. 실제 PWA 권한·설치 capability는 Web/PWA 별도 테스트 | 물리 iPhone 설치와 Apple 권한 UI |
| PUSH-002 | 같은 시나리오: 다중 설치별 문서, 멤버 binding, 일반 사용자 FID 문서 조회 403 | 일반 로그 전면 검사는 Native 실제 capture 로그 검증과 별개 |
| PUSH-003 | 같은 시나리오: 같은 FID refresh, SDK 조건부 inactive, logout 설치 하나 삭제, stale logout 무시, 재등록 TTL 제거 | 물리 OS의 FID 발급/재설치 |
| PUSH-004 | Android 수집·Shortcut 시나리오: 실제 결제 입력부터 Android NoTarget, 본인 iOS 2대만 전송. 보존 기간 시나리오: 실제 producer envelope의 채널만 외부 입력 fixture로 바꿔 recurring/system NoTarget·unknown ContractFailure | recurring producer 자체 실행은 `recurring-execution.spec.ts` 소유 |
| PUSH-005 | 3인 가구 UI 시나리오: 생성자와 다른 요청자, requester 2대 제외, 나머지 2명 4대 모두 전송. 수신 설정 시나리오: NoTarget | 없음(서버 전송 경계 기준) |
| PUSH-006 | `web/e2e-pwa/worker-events.spec.ts` 실제 생산 worker 클릭 처리, `web/e2e/notification-deeplink.spec.ts` 실제 인증된 지출 화면 | APNs 실제 수신·OS 알림 탭 전달 |
| PUSH-007 | `FcmFirebaseE2ETest.kt::registeredCallbackConfirmsServerBindingBeforeForegroundNotificationAndLogoutBlocksIt`: 실제 onRegistered→인증 서버 등록→표시 binding 확인, 실제 FcmService callback→NotificationManager channel/내용→PendingIntent/MainActivity, data-only·다른 member·로그아웃 표시 차단 | 물리 외부 FCM 메시지 전송 |
| PUSH-008 | UI fanout·FID 수명주기·provider 오류 시나리오: 모두 1회, 현재 UNREGISTERED만 inactive, 새 version 등록 뒤 늦은 404 보존, terminal 뒤 재전송 없음 | 운영 관리자 지연 집계는 별도 운영 계측 테스트 |
| PUSH-009 | 인증된 FID 등록 시나리오: 무인증·타 가구·빈 FID·위조 member payload 거부, 기존 endpoint 내용 그대로, private collection 403 | Repository 호출 0회는 애플리케이션 단위 테스트에서 검증; E2E는 외부 결과·변경 없음 검사 |
| PUSH-010 | UI 시나리오의 실제 producer envelope 동시 broker 재전달, provider 오류 후 replay, 31일 지난 이벤트 ExpiredEvent와 30일 TTL metadata | Firestore TTL daemon 자체 실행은 Emulator가 재현하지 않음 |
| PUSH-011 | `web/e2e-pwa/worker-events.spec.ts`: 실제 생산 worker의 허용 경로·origin·불법 payload 검사 | 물리 OS의 클릭 이벤트 전달 |
| PUSH-012 | 실제 관리자 제거·복구 시나리오: 제거한 멤버 2대 정리, 중복 제거 이벤트, 다른 멤버·terminal delivery 유지, 제거 중 등록 거부, 복구 후 자동 부활 없음, 새 등록 후 수신. 일반 Auth JWT와 공개 session callable→Auth custom-token 교환으로 발급한 Native JWT 각각 수집 warm→제거 후 같은 JWT의 새 수집 거부·거래/영수증 무변경→복구 후 새 수집 성공 | provider 호출 직전 멤버 제거 경합은 실제 저장소 단위/통합 검증과 구분 |
| PUSH-013 | purge 시나리오: 실제 compiled production participant + Firestore transaction, capability 거부·논리 삭제 no-op, 2개씩 page 삭제, 같은 checkpoint 결과 재생, 타 가구·FCM 관측 문서 보존 | Access의 전체 영구 삭제 승인 process는 별도 Access E2E; 여기서는 Notifications participant 경계부터 실행 |
| PUSH-014 | 실제 Android/Shortcut 수집 시나리오: preference 없음은 enabled, disabled는 자동·명시 모두 제외, endpoint와 수집 유지, enabled 복원 후 수신 | provider 직전 동시 preference 변경은 애플리케이션/Adapter 테스트와 구분 |

2026-09-11 공식 Web 전체 E2E 89개 재실행에서 알림 7개가 모두 통과했습니다. FID lifecycle의 정상 typed AUTH_REQUIRED 응답, UI fanout·Android/Shortcut 수집과 수신 설정·provider 오류/늦은 UNREGISTERED·이벤트 보존 기간·실제 purge를 확인했습니다. 제거/복구는 실제 결함을 재현한 뒤 수정했습니다. 제거 전에 수집에 성공한 일반 Auth JWT와 공개 session 발급·Auth 교환으로 얻은 Native JWT 모두, 제거 뒤 새 결제가 거부되고 거래·영수증이 변하지 않았습니다. 멤버 복원 후 같은 토큰의 새 수집이 다시 성공하는 것까지 검증했습니다. 이 결과와 Android OS 알림 클릭을 실행하는 Native Firebase E2E 결과는 구분합니다.

후속 Android Native 실행에서는 실제 FCM 서버 등록·OS 알림 표시·알림 탭으로 MainActivity 실행·로그아웃 차단 테스트도 통과했습니다. 테스트 후 결과 파일 수집의 runner 오류와 아직 실행되지 않은 후속 Web 검증은 [Native 실행 기록](real-code-test-cleanup.md#검증-기록)에 별도로 기록했습니다.
