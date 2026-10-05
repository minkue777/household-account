# 같은 후보의 중복 빌드 제거

TOOL03/PT01: 배포 wrapper가 한 번 architecture 검사·production build·child 복사를 끝내고, Firebase의 세 codebase predeploy가 같은 artifact hash·clean HEAD·actor·lease를 다시 확인한다. 각 predeploy에서 root build와 architecture를 반복해 배포 도중 이미 승인된 파일을 지우고 다시 만들던 경로를 제거했다. `--print-hashes`와 실제 배포의 준비는 서로 다른 명령이므로 실제 배포는 여전히 후보를 새로 빌드한다. 과거 파일을 무조건 신뢰하는 build cache를 추가하지 않았다.

Functions CI는 이미 전체 unit에 포함된 architecture를 build prehook으로 다시 실행하지 않는다. 같은 checkout에서 만든 결과물을 child codebase에 복사하고 callable 통합 검사를 수행한다. 로컬 독립 callable 명령은 pretest에서 필요한 build를 자동 준비한다. Web E2E CI는 앞 단계의 브라우저·시스템 라이브러리 설치를 재사용하고 Functions 준비를 명시적으로 실행한다. 각 독립 CI job 사이의 준비는 공유하지 않는다.

구조 검사는 정확한 npm shell 문구·collector 함수명·400줄 제한을 더 이상 요구하지 않는다. codebase export 분리와 guard 연결, 공개 client/서버에서 migration API를 노출하지 않는 경계는 유지한다. 실제 wrapper의 artifact·dirty HEAD·actor·smoke marker 검사와 직접 guard 실행의 fail-closed 회귀를 검증한다. 운영 migration dry-run/apply 검사는 삭제하지 않았다.

관련 architecture·배포 후보·scope 검사 4파일 33개로 검증한다. 전체 CI의 실제 callable·Native 경로 결과는 새 SHA로 추적한다. 로그: `TEMP/household-simplicity-build-once-20261005.log`.
