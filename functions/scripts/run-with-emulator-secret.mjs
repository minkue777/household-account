import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { withEmulatorSecrets } from "../../tools/e2e/emulator-secrets.mjs";

const functionsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const secretPaths = [functionsDirectory, resolve(functionsDirectory, '../functions-payment-capture'),
  resolve(functionsDirectory, '../functions-access-session')].map(directory => resolve(directory, '.secret.local'));
const [command, ...args] = process.argv.slice(2);

if (command === undefined) {
  throw new Error("실행할 에뮬레이터 명령이 필요합니다.");
}

function assertWindowsCommandToken(value) {
  if (/["&|<>^%\r\n]/u.test(value)) {
    throw new Error("Windows shell에서 안전하지 않은 명령 인자입니다.");
  }
}

await withEmulatorSecrets(secretPaths, async () => {
  const exitCode = await new Promise((resolveExit, reject) => {
    const windows = process.platform === "win32";
    if (windows) {
      [command, ...args].forEach(assertWindowsCommandToken);
    }
    const child = spawn(
      windows ? (process.env.ComSpec ?? "cmd.exe") : command,
      windows ? ["/d", "/s", "/c", command, ...args] : args,
      {
        cwd: process.cwd(),
        env: process.env,
        shell: false,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`에뮬레이터 명령이 ${signal} 신호로 종료되었습니다.`));
        return;
      }
      resolveExit(code ?? 1);
    });
  });
  process.exitCode = exitCode;
});
