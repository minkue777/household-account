## Communication
- Always respond in Korean using polite honorific speech.
- Do not use informal speech.
- Write git commit messages in Korean.

## Independent CI and deployment
- Build and deploy the requested surface without waiting for full CI. A successful deployment does not mean that CI passed.
- Run `quality-gates.yml` independently for every main push and pull request. It retains Functions, Web, Web E2E, Android, and applicable Android instrumentation checks. Run relevant local tests when developing a change, but do not rerun the full suite as a commit, push, or deployment prerequisite.
- Production builds, explicit target and actor authorization, immutable commit/artifact/hash checks, secret bindings, compatibility checks, deployment leases, and post-deployment smoke remain deployment requirements. Build or deployment/smoke failures block reporting deployment success.
- Android emulator instrumentation is required only for changes under `android/`, `contracts/`, `web/src/platform/android-host/`, or the Android bridge/auth/Firebase files listed in `tools/ci/android-instrumentation-scope.mjs`. Web-only presentation changes (text, colors, layout, category UI) do not require it; verify relevant Web behavior instead. Manual workflow runs execute the full emulator suite.
- Report deployment and CI status separately, with the exact commit and CI run link. Pending, failed, cancelled, skipped, or missing CI must never be described as passed; investigate and report later failures without automatically rolling back an otherwise completed deployment.
- CI failures remain failures. Do not disable tests, lifecycle hooks, or use skip/force options to fabricate success. The `quality-summary` job records all five results and fails if any required job does not succeed; a successful Android scope check is valid when emulator tests do not apply.
- GitHub Actions native notifications follow the user's notification settings. Do not promise an external alert was delivered or change those settings without verifying it; no Slack/email messages are sent automatically by this repository.

