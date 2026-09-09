## Communication
- Always respond in Korean using polite honorific speech.
- Do not use informal speech.
- Write git commit messages in Korean.

## Mandatory quality gates
- Before any commit, push, deployment, or release, run `npm --prefix functions run test:quality-gate`.
- When Web or Android files change, also run that surface's active tests and production build.
- Android emulator instrumentation is required only for changes under `android/`, `contracts/`, `web/src/platform/android-host/`, or the Android bridge/auth/Firebase files listed in `tools/ci/android-instrumentation-scope.mjs`. Web-only presentation changes (text, colors, layout, category UI) do not require it; verify relevant Web behavior instead. Manual workflow runs execute the full emulator suite.
- If any required gate fails, do not commit, push, deploy, release, or report completion, even when the failure appears unrelated to the current change. Resolve it or stop and report the blocker.
- After a push, do not deploy or release until the `quality-gates.yml` workflow for that exact HEAD completes successfully. Missing, pending, failed, cancelled, or skipped required jobs are blockers. The `android-instrumentation` job succeeds after checking the change scope when emulator tests are not applicable; its conditionally omitted emulator steps are not blockers. If applicable, every emulator test must pass.
- Never bypass a gate by disabling lifecycle hooks, editing the gate out of a deployment command, or using a skip or force option.

