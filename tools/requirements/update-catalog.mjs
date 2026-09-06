import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const docs = join(root, 'docs/requirements');
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const markdown = walk(docs).filter(file => file.endsWith('.md'));
const sources = markdown.filter(file => /[\\/]modules[\\/][^\\/]+[\\/]requirements\.md$/.test(file) || file === join(docs, 'system/context.md'));
const declarations = [];
const tests = new Map();
const modules = [];
for (const file of markdown) {
  for (const match of readFileSync(file, 'utf8').matchAll(/^\|\s*(T-[A-Z0-9-]+)\s*\|/gm)) {
    if (tests.has(match[1])) throw new Error(`Duplicate canonical test ID: ${match[1]}`);
    tests.set(match[1], file);
  }
}
for (const file of sources.sort()) {
  let requirementsSection = false;
  const requirements = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^## /.test(line)) requirementsSection = /^## (?:5\. 요구사항|6\. 공통 요구사항)\s*$/.test(line);
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(value => value.trim());
    const match = cells[0]?.match(/^\[?((?!T-)[A-Z][A-Z0-9-]*-\d{3})(?:\]\([^)]+\))?$/);
    if (requirementsSection && match) { requirements.push(match[1]); declarations.push({ id: match[1], status: cells[1], file }); }
  }
  const path = relative(docs, file).replaceAll('\\', '/');
  modules.push({ path, group: path.startsWith('contexts/') ? path.split('/')[1] : path.startsWith('system/') ? 'system' : 'supporting-platform', count: requirements.length, tests: [...tests.values()].filter(owner => dirname(owner) === dirname(file)).length });
}
if (new Set(declarations.map(value => value.id)).size !== declarations.length) throw new Error('요구사항 ID 중복 소유');
const groups = Object.fromEntries([...new Set(modules.map(value => value.group))].map(group => [group, modules.filter(value => value.group === group).reduce((sum, value) => sum + value.count, 0)]));
const statuses = new Map();
for (const declaration of declarations) statuses.set(declaration.status, (statuses.get(declaration.status) ?? 0) + 1);
const output = [
  '# 요구사항·테스트 선언 집계', '',
  '`node tools/requirements/update-catalog.mjs`로 생성합니다. 실행 결과나 구현 완료 개수가 아닌 문서 선언 집계입니다.', '',
  `- 요구사항: ${declarations.length}개 (고유 ID ${new Set(declarations.map(value => value.id)).size}개)`,
  `- Canonical 테스트 시나리오 ID: ${tests.size}개`, '',
  '| 소유 영역 | 요구사항 |', '|---|---:|', ...Object.entries(groups).map(([group, count]) => `| ${group} | ${count} |`), '',
  '| 모듈 | 요구사항 | 테스트 시나리오 ID |', '|---|---:|---:|',
  ...modules.map(value => `| [${value.path.replace(/\/requirements\.md$/, '')}](${value.path}) | ${value.count} | ${value.tests} |`), '',
  '| 선언 상태 | 요구사항 |', '|---|---:|', ...[...statuses].sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => `| ${status} | ${count} |`), '',
].join('\n');
const destination = join(docs, 'catalog-summary.md');
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== output) throw new Error('집계 문서가 오래되었습니다. node tools/requirements/update-catalog.mjs를 실행하세요.');
} else writeFileSync(destination, output, 'utf8');
console.log(JSON.stringify({ requirements: declarations.length, tests: tests.size, groups }));
