# 국민성장펀드 기준가 전용 중계

## 원인과 범위

2026-10-26 23:55 KST의 공식 기준가 조회는 성공했지만 10월 27일은 `PROVIDER_UNAVAILABLE`, 이후는 `HTTP_STATUS_NOT_SUPPORTED`로 실패했다. 기존 HTTP 실패 변환이 숫자 status를 보존하지 않아 이 기록만으로 운영 응답을 403으로 확정할 수 없다. 같은 URL·헤더·파서는 로컬에서 정상이며, [미래에셋 10월 29일 공지](https://investments.miraeasset.com/magi/board/news/view.do?id=16982&boardCode=1)의 해외 접속 차단 조치와 장애 시점이 겹친다. 출발 네트워크에 따른 접속 제한이 유력하지만 정확한 차단 조건은 미확정이다.

사용자가 운영하는 Linux 서버를 경유한 MobaXterm SOCKS 조회는 HTTP 200, 0.205598초였다. 공식 HTML에서 2026-10-30 기준가 995.71원과 앞선 일별 값을 확인했다. 이는 Linux 출발 조회 가능성의 증거이며 Firebase에서 상시 중계가 배포됐다는 뜻은 아니다.

## 변경 계약

- `FUND-001`: 동일 C-e 표준코드 `K55301EW0012`·class `539502`, 기존 HTML 파서, 비미래 최신 기준일, 1,000좌당 가격·평가식을 유지한다.
- Linux 서버는 [Nginx 고정 경로 설정](../../tools/operations/fund-nav-relay.nginx.conf)으로 공식 URL 한 곳만 중계한다. Firebase는 HTTPS와 Bearer 인증으로 연결한다. PC·MobaXterm의 실행 여부와 독립적이다.
- `FUND_NAV_RELAY` Secret의 JSON `url`·`token`을 사용하고 Command·Query·일일 자산 평가에 bind한다. 인증값을 요청 입력·Git·로그에 기록하지 않는다. 중계가 원천에 보내는 요청 헤더는 고정 Host·User-Agent·Accept뿐이다.
- redirect·임의 목적지·원천에 인증 전달·직접 접속 fallback·새 시세 캐시는 두지 않는다. URL query·fragment를 설정에서 거절하고 중계도 query가 있으면 400으로 거절한다. 실패 때 마지막 정상 가격과 날짜를 보존하며 다른 종목의 조회 경로는 유지한다.
- Emulator는 운영 Secret 조회를 하지 않도록 임시 `FUND_NAV_RELAY='{}'`를 제공한다. 실제 펀드 조회를 위장하지 않고 설정 실패를 반환한다. caller 파일에 누락된 fixture만 임시 추가하고 실행 후 원문으로 복원하며, 실행 중 외부에서 바뀐 파일은 덮어쓰지 않는다. 같은 파일 집합의 겹친 실행은 PID·UUID 잠금으로 거절한다. 강제 종료로 남은 잠금은 실행이 끝났는지 확인한 뒤 수동 정리한다.

## 배포 절차

1. 서버의 기존 HTTPS 가상호스트·인증서·Nginx 설정을 읽고 다른 서비스와 경로가 겹치지 않는지 확인한다. 이번 서버는 Ubuntu 20.04, SSH만 실행 중이고 웹서비스·인증서가 없었다. Nginx를 설치하고 패키지 기본 site를 `/etc/household-fund-nav/nginx-default.before`에 보존한 뒤 [전용 HTTP·HTTPS 설정](../../tools/operations/fund-nav-relay-server.nginx.conf)을 설치했다. 임시 배포 SSH 키는 사용자 등록 후 이용하고 설치 종료 후 제거한다.
2. 고정 경로 설정의 token을 안전한 난수로 치환한 파일을 root 소유 0600으로 설치한다. 템플릿 원문에는 실제 token을 저장하지 않는다. `nginx -t` 성공 후 reload하며 기존 설정과 복구 지점을 보존한다.
3. 외부에서 인증 없는 요청 거절, 잘못된 메서드 거절, 인증된 공식 HTML·기준일·기준가, 추가 query 거절을 검증한다. 운영 가구의 가격을 검증용으로 직접 수정하지 않는다.
4. 같은 HTTPS URL·token을 Secret Manager에 등록하고 clean commit의 배포 계획·manifest에 Secret version을 포함해 Firebase wrapper로 세 codebase를 배포한다. 기본 smoke와 배포 Secret binding을 확인한다. Web·APK는 변경하지 않는다.
5. 자연 발생한 자산 갱신 또는 예약 작업의 기준가 provider 결과로 실제 운영 복구를 확인한다. 공개 HTML 조회만으로 전체 가구 갱신 성공을 보고하지 않는다.

## 인증서·운영

- [Let's Encrypt IP 인증서](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/)를 `shortlived` profile로 발급했다. 최초 인증서는 2026-11-05 19:14:35 UTC까지 유효하며 IP SAN을 검증했다. 자체 서명이나 TLS 검증 해제는 사용하지 않는다.
- acme.sh v3.1.7 원본 commit `37d064f7b580055d3f2ddf9a9c960f754f3694d6`, script SHA-256 `fa4842619ddf50f774d79092ae06887a2107c660757283b763bef834dfc150ff`를 사용한다. `/opt/household-fund-nav/acme.sh`에서 실행하며 설정은 `/var/lib/household-fund-nav/acme`, 설치 인증서는 `/etc/household-fund-nav/tls`다.
- `--days 3`으로 만료 전 갱신하고 [systemd service](../../tools/operations/fund-nav-relay-renew.service)·[timer](../../tools/operations/fund-nav-relay-renew.timer)가 하루 두 번 확인한다. 갱신 후 `nginx -t && systemctl reload nginx`를 실행한다. timer enabled, 최초 cron 실행 `Result=success`·`ExecMainStatus=0`을 확인했다. 인증서 발급과 자동 작업 등록은 완료됐지만 미래 갱신 성공을 미리 주장하지 않는다.
- 포트 80은 ACME challenge 경로만 제공하고 그 외 404다. 포트 443은 인증된 기준가 경로만 제공한다. Secret을 포함한 렌더링 설정·인증서 키는 root 소유 0600, 상위 디렉터리는 0700이다. 실제 token을 repo에 저장하지 않는다.
- 중단·복구는 기존 직접 조회로 조용히 되돌리지 않고 새 Firebase 후보로 진행한다. 중계 정지가 필요하면 해당 site만 비활성화하며 SSH와 다른 서비스를 건드리지 않는다. 운영 코드가 중계에 의존하는 동안 timer·인증서·relay 설정을 삭제하지 않는다.

## 현재 검증 상태

- 기존 MobaXterm 터널의 공개 기준가 GET 성공. 운영 데이터 변경 없음.
- Emulator Secret 파일 생성·caller 보존·복원·불일치·동시 실행 차단 10개 검사 통과.
- Node 22.23.4에서 시세 Adapter·펀드 계약·Emulator 파일·architecture 합계 107개 통과. production build 성공. callable Emulator 검사도 Node 22의 세 codebase에서 3개 통과했으며 임시 Secret·잠금 잔여가 없음을 확인했다.
- Node 22.23.4의 외부 HTTPS probe: 무인증/오인증 401, POST 405, 다른 경로 404, 추가 query 400. 공식 HTML 200, 표본 36ms. 이 값은 전체 자산 갱신 시간이나 GCP 출발 조회 시간과 다르다.
- 초기 Nginx 검증에서 caller query를 허용하자 URL 형태 값을 넣은 요청은 원천 CloudFront 403을 반환했다. [Nginx 1.18 정적 proxy_pass 경로](https://github.com/nginx/nginx/blob/release-1.18.0/src/http/modules/ngx_http_proxy_module.c#L1332)의 args 전달을 확인하고 query 없는 고정 endpoint 계약으로 제한했다. CloudFront의 구체적인 차단 규칙은 미확정이며, 최종 중계는 해당 입력을 원천 요청 전에 400으로 거절한다.
- 같은 production adapter를 Firestore 관측 저장 없이 실행해 `miraeasset-fund-nav`, 기준일 `2026-10-30`, NAV `995.71`을 확인했다.
- Linux 중계·인증서·갱신 timer 설치 완료. Firebase Secret `FUND_NAV_RELAY` version 1 활성화. 제품 SHA `a9c206754b5a79c25d84c6cc5fc7083ea1b07af9`를 `release-20261030-fund-relay-a9c20675`로 세 codebase에 배포했고 13:22 KST 기본 smoke·provenance `completed`를 확인했다. Command rev78·Query rev61·일일 평가 rev57 모두 ACTIVE/Node 22와 Secret version 1 바인딩을 확인했다. 기본 smoke는 사용자 로그인·실제 가구 갱신 검사가 아니다.
- 설치를 마친 후 임시 SSH 공개키 한 줄만 제거하고 해당 키의 인증 거절을 확인했다. 기존 접속 키·MobaXterm 터널은 보존했다. 렌더링 설정의 staging 복제본은 삭제하고 서비스가 사용하는 root 전용 설정·Secret Manager 값은 유지했다.
- 제품 CI [41002126793](https://github.com/minkue777/household-account/actions/runs/41002126793): 13:23 KST functions·web·android 성공, web-e2e·android-instrumentation 진행 중. 별도 후속 확인으로 전체 결과를 확정한다. Web·APK 실행 파일은 변경하지 않았다.
- 배포 직후 조회한 로그에는 새 `miraeasset-fund-nav` 운영 호출이 없었다. Firebase 출발 업무 경로의 복구와 전체 갱신 3초 달성은 아직 미확인이다. 자연 발생한 다음 갱신의 provider 결과·total로 판정하며 공개 HTML probe의 37ms를 전체 갱신 시간으로 쓰지 않는다.

## CI의 Scheduler fixture 누락 보강

- 제품 CI `41002126793`과 문서 후속 CI `41002635602`는 모두 `portfolio-provider-jobs.spec.ts:34`에서 실패했다. 각각 Web E2E 120개 성공·1개 실패이며 나머지 네 검사는 성공했다. 과거 실행을 성공으로 변경하지 않는다.
- 별도 Node 프로세스로 실행하는 Scheduler helper에는 `FUND_NAV_RELAY`가 주입되지 않았다. 펀드 HTTP가 호출되지 않았고 assertion도 이전 직접 접속 URL의 `fundCd=539502`를 기대했다. 운영 Secret 바인딩 실패가 아닌 테스트 실행 구성 누락이다.
- Scheduler 모듈 로드 전에 테스트 전용 HTTPS URL·Bearer 값을 주입한다. 실제 HTTP 경계 fixture에서 인증 헤더를 검사하고 정확한 중계 URL 한 번 호출·원천 직접 요청 없음·NAV 1,200·공식 provider·오늘 기준일·평가액 3,000원을 검증한다. 운영 중계·자격 증명은 테스트에 쓰지 않는다.
- 로컬 보강 검사의 첫 실행에서 두 번째 Scheduler 호출의 기존 `rejects.toThrow()`는 통과했지만 공급자 상태가 `SUCCESS`로 남는 빈틈이 드러났다. 미래 예약 날짜만 전달하고 30초의 실제 갱신 쿨다운이 남은 상태에서 실행했기 때문이다. 저장된 `nextAllowedAt`까지 기다린 뒤 실제 503 요청, `RETRYABLE_FAILURE/PROVIDER_UNAVAILABLE`, 마지막 정상 NAV·기준일·자산 잔액 보존을 함께 검사한다. 정상값 보존은 기존 Scheduler 계약의 완료 결과이며 공급자 실패 기록을 성공으로 바꾸지 않는다.
- 이번 후속은 E2E helper·검사·문서만 변경하므로 Firebase·Web·APK 재배포 대상은 없다.
- Node 22.23.4·Java 21·실제 Auth/Firestore/Functions Emulator·Chromium에서 해당 파일의 E2E 두 건을 다시 실행해 모두 통과했다(시세 42.2초, KIND 7.1초, 전체 1.3분). 정상 중계 인증과 가격 반영, 실제 503 관측과 값 보존을 확인했으며 기존 실패 이력은 위에 유지한다. 로그: `%TEMP%/household-fund-relay-e2e-20261030-r2.log`.
