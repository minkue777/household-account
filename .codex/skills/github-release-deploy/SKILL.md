---
name: github-release-deploy
description: Household-account 프로젝트의 Android APK를 GitHub Releases로 배포하는 절차. 사용자가 "깃헙으로 배포", "release 배포", "APK 배포", "새 버전 배포", "GitHub 릴리즈 만들어줘"처럼 GitHub Release에 Android APK를 올리라고 요청할 때 사용한다.
---

# GitHub Release Deploy

## 기본 원칙

- 한국어 존댓말로 진행하고, git commit 메시지는 한국어로 작성한다.
- PowerShell 환경에서는 `&&` 체인을 쓰지 말고 명령을 나누거나 PowerShell 조건문을 사용한다.
- 배포 전 `git status --short`를 확인한다. 사용자 변경으로 보이는 미커밋 변경은 임의로 되돌리지 않는다.
- 사용자가 버전을 지정하지 않으면 `android/app/build.gradle.kts`의 `versionName` patch를 1 올리고 `versionCode`도 1 올린다.
- GitHub Release 태그는 `v<versionName>`, APK 파일명은 `household-account-v<versionName>.apk`로 맞춘다.
- 릴리즈 APK는 `android/keystore.properties`가 있을 때만 서명된다. 파일이 없으면 배포를 중단하고 사용자에게 보고한다.

## 배포 절차

1. 현재 상태 확인
   - `git status --short`
   - `git remote -v`
   - `android/app/build.gradle.kts`에서 `versionCode`, `versionName`, signing config 확인
   - 가능하면 `gh release list --limit 5`로 최근 태그를 확인한다.

2. 버전 갱신
   - `android/app/build.gradle.kts`의 `versionCode`와 `versionName`만 수정한다.
   - 예: `versionCode = 6`, `versionName = "1.2.4"` -> `versionCode = 7`, `versionName = "1.2.5"`
   - 버전 변경은 `apply_patch`로 최소 수정한다.

3. 검증과 빌드
   - 웹 변경이 포함되어 있거나 전체 검증이 필요한 경우: `npm --prefix web run build`
   - Android release APK 빌드: `.\gradlew.bat :app:assembleRelease`를 `android` 디렉터리에서 실행
   - release APK 경로: `android/app/build/outputs/apk/release/app-release.apk`

4. 커밋과 푸시
   - 버전 변경 또는 배포에 포함할 변경을 스테이징한다.
   - 커밋 메시지 예: `릴리즈 v1.2.5 준비`
   - `git push`로 원격 `main`에 올린다.

5. GitHub Release 생성
   - 루트에 APK 복사:
     ```powershell
     Copy-Item -LiteralPath android\app\build\outputs\apk\release\app-release.apk -Destination household-account-v1.2.5.apk -Force
     ```
   - 기본 명령:
     ```powershell
     gh release create v1.2.5 household-account-v1.2.5.apk --title "v1.2.5" --notes "Android APK v1.2.5"
     ```
   - `gh auth status`가 만료되어 실패하지만 git credential은 살아 있으면, 토큰을 출력하지 않는 같은 PowerShell 프로세스 안에서만 `GH_TOKEN`을 설정해 재시도한다:
     ```powershell
     $version = "1.2.5"
     $asset = "household-account-v$version.apk"
     $credential = "protocol=https`nhost=github.com`n`n" | git credential fill
     $token = ($credential | Where-Object { $_ -like "password=*" }) -replace "^password=", ""
     if ($token) { $env:GH_TOKEN = $token }
     gh release create "v$version" $asset --title "v$version" --notes "Android APK v$version"
     ```
   - 같은 태그의 릴리즈가 이미 있으면 덮어쓰지 말고 사용자에게 확인한다. 명시적으로 재업로드를 요청받은 경우에만 `gh release upload <tag> <asset> --clobber`를 사용한다.

6. 배포 확인과 정리
   - `gh release view v1.2.5 --json url,assets,tagName`
   - 최종 APK URL 형식:
     `https://github.com/minkue777/household-account/releases/download/v1.2.5/household-account-v1.2.5.apk`
   - 루트에 복사한 APK는 업로드 후 생성한 파일이 확실할 때만 삭제해 작업트리를 깨끗하게 유지한다.
   - 최종 응답에는 버전, 커밋 해시, 빌드 통과 여부, 릴리즈 URL을 짧게 포함한다.

## 실패 시 처리

- `android/keystore.properties`가 없으면 서명된 release APK가 아니므로 배포하지 않는다.
- 빌드 실패 시 Release 생성으로 넘어가지 않는다.
- `gh` 인증 실패 시 토큰 값을 출력하지 않는다.
- 푸시가 실패하면 Release 생성 전에 멈추고 원격 상태를 확인한다.
