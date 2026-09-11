import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executableEvidence, requirementDeclarations, workspaceRoot } from './executable-tests.mjs';

const declarations = requirementDeclarations();
const tests = executableEvidence().filter(test => test.level === 'e2e');
const exceptions = JSON.parse(readFileSync(resolve(workspaceRoot, 'docs/testing/e2e-exceptions.json'), 'utf8')).requirements;
const errors = [];
for (const exception of exceptions) {
  if (!declarations.some(req => req.id === exception.id)) errors.push(`선언이 없는 예외: ${exception.id}`);
  if (!exception.reason?.trim() || !existsSync(resolve(workspaceRoot, exception.reference ?? 'missing'))) errors.push(`근거가 없는 예외: ${exception.id}`);
  if (exceptions.filter(item => item.id === exception.id).length !== 1) errors.push(`중복 예외: ${exception.id}`);
}
const requirements = declarations.map(req => {
  const cases = tests.filter(test => test.ids.includes(req.id));
  const exception = exceptions.find(item => item.id === req.id);
  if (!cases.length && !exception) errors.push(`E2E 연결이 없는 요구사항: ${req.id}`);
  return { id: req.id, source: req.file, caseIds: cases.map(test => test.caseId),
    ...(exception ? { externalOrRetiredBoundary: exception.reason, reference: exception.reference } : {}) };
});
const summary = { requirements: requirements.length, withE2E: requirements.filter(req => req.caseIds.length > 0).length,
  externalOrRetired: requirements.filter(req => req.externalOrRetiredBoundary).length, missing: errors };

if (process.argv.includes('--write')) {
  const rows = requirements.map(req => {
    const files = [...new Set(req.caseIds.map(id => id.split('::')[0]))];
    return `| [${req.id}](../../${req.source}) | ${files.map(file => `[${file.split('/').at(-1)}](../../${file})`).join(', ') || '공개 실행 경로 없음 / 운영 경계'} | ${req.externalOrRetiredBoundary ?? '세부 assertion·환경 한계는 영역별 매핑 문서 참조'} |`;
  });
  const content = [
    '# 요구사항과 실행 E2E 연결', '',
    '`node tools/requirements/e2e-coverage.mjs --write`로 생성합니다. 선언된 실제 테스트 함수와 Native 파일::메서드 연결을 검사합니다. ID를 적은 주석·fixture·직접 skip/todo 선언은 증거로 사용하지 않습니다.', '',
    '**이 표는 실행 연결이며 전체 수용 조건의 통과율이 아닙니다.** 실제 통과 여부는 Playwright JSON/JUnit 결과로 확인합니다. 한 요구사항의 정상 흐름 E2E가 모든 실패 타이밍·외부서비스·실기기 동작을 검증했다는 뜻이 아닙니다. 정확한 assertion·남은 경계는 [재무/접근](e2e-finance-mapping.md), [결제 수집](e2e-payment-mapping.md), [자산/관리자/PWA](e2e-portfolio-admin-mapping.md), [알림](e2e-notifications-mapping.md), [운영 CLI](e2e-operations-mapping.md), [Native](native-real-code-coverage.json)를 확인합니다.', '',
    `요구사항 ${summary.requirements}개, E2E 연결 ${summary.withE2E}개, 운영/폐기 경계 ${summary.externalOrRetired}개. 새 요구사항에 실행 E2E 또는 명시적 운영 경계가 없으면 품질 gate가 실패합니다.`, '',
    '| 요구사항 | 실제 테스트 파일 | 범위 |', '|---|---|---|', ...rows, '',
  ].join('\n');
  writeFileSync(resolve(workspaceRoot, 'docs/testing/e2e-requirement-coverage.md'), content, 'utf8');
}
console.log(JSON.stringify(process.argv.includes('--json') ? { ...summary, declarations: requirements } : summary, null, 2));
if (errors.length) process.exitCode = 1;
