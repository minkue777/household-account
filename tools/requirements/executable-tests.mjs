import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(workspaceRoot, 'functions/package.json'));
const ts = require('typescript');
const roots = ['functions/test', 'web/src/__tests__', 'web/e2e', 'web/e2e-pwa', 'android/app/src/test', 'android/app/src/androidTest'];

function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

export function identifiers(value) {
  return [...new Set(value.match(/(?<![A-Z0-9-])(?:T-)?[A-Z][A-Z0-9-]*-\d{3}(?![A-Z0-9-])/g) ?? [])];
}

/** Reads executable test declarations. Comments, fixtures and test.todo/skip are not evidence. */
export function executableTests() {
  const result = [];
  for (const file of roots.flatMap(root => files(resolve(workspaceRoot, root)))) {
    const path = relative(workspaceRoot, file).replaceAll('\\', '/');
    if (/\/architecture\//.test(path) || !/\.(?:(?:test|spec)\.tsx?|kt)$/.test(path)) continue;
    const source = readFileSync(file, 'utf8');
    const level = /\/e2e(?:-pwa)?\//.test(path) || path.includes('/androidTest/') ? 'e2e'
      : path.includes('/integration/') ? 'integration' : 'unit';
    if (extname(file) === '.kt') {
      // A JUnit @Test annotation must directly precede a real method, not an ID in a comment.
      const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const match of clean.matchAll(/@Test(?:\([^)]*\))?\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:public\s+)?fun\s+(`[^`]+`|\w+)\s*\([^)]*\)\s*(?:=\s*(?:runBlocking|runTest)\s*)?\{/g)) {
        const name = match[1].replaceAll('`', '');
        result.push({ file: path, title: name, caseId: `${path}::${name}`, level, ids: identifiers(name) });
      }
      continue;
    }
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function walk(node, suites = []) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(tree);
        const first = node.arguments[0];
        const callback = node.arguments.at(-1);
        const title = first && (ts.isStringLiteralLike(first) ? first.text : undefined);
        const disabled = /\.(?:skip|todo|fixme)\b/.test(callee);
        if (/^(?:describe|test\.describe)(?:\b|\.)/.test(callee) && title && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          if (!disabled) walk(callback.body, [...suites, title]);
          return;
        }
        if (/^(?:it|test)(?:\b|\.|\()/.test(callee) && !callee.startsWith('test.describe') && title && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          if (!disabled && callback.body && callback.body.getText(tree).replace(/[\s{}]/g, '') !== '') {
            const fullTitle = [...suites, title].join(' > ');
            result.push({ file: path, title: fullTitle, caseId: `${path}::${fullTitle}`, level, ids: identifiers(fullTitle) });
          }
          return;
        }
      }
      ts.forEachChild(node, child => walk(child, suites));
    }
    walk(tree);
  }
  return result;
}

export function executableEvidence() {
  const tests = executableTests();
  const mapping = JSON.parse(readFileSync(resolve(workspaceRoot, 'docs/testing/native-real-code-coverage.json'), 'utf8').replace(/^\uFEFF/, ''));
  const unresolved = [];
  for (const entry of mapping.mappings) for (const reference of entry.tests) {
    const cases = tests.filter(test => reference.includes('::') ? test.caseId === reference : test.file === reference);
    if (!cases.length) unresolved.push(reference);
    for (const test of cases) test.ids = [...new Set([...test.ids, entry.canonicalId, ...entry.requirementIds])];
  }
  if (unresolved.length) throw new Error(`실행 case가 없는 요구사항 연결:\n${unresolved.join('\n')}`);
  return tests;
}

export function requirementDeclarations() {
  const root = resolve(workspaceRoot, 'docs/requirements');
  return files(root).filter(file => /(?:\/|\\)(?:requirements|context)\.md$/.test(file)).flatMap(file => {
    const source = readFileSync(file, 'utf8');
    const section = source.match(/## (?:5\. 요구사항|6\. 공통 요구사항)\s*\r?\n([\s\S]*?)(?=\r?\n## |$)/)?.[1] ?? '';
    return [...section.matchAll(/^\|\s*\[?((?!T-)[A-Z][A-Z0-9-]*-\d{3})(?:\]\([^)]+\))?\s*\|([^\n]*)/gm)].map(match => ({
      id: match[1], file: relative(workspaceRoot, file).replaceAll('\\', '/'), row: match[2].trim(),
    }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tests = process.argv.includes('--evidence') ? executableEvidence() : executableTests();
  const requirements = requirementDeclarations();
  console.log(JSON.stringify({
    cases: tests.length,
    requirements: requirements.length,
    noDirectE2E: requirements.filter(req => !tests.some(test => test.level === 'e2e' && test.ids.includes(req.id))).map(req => req.id),
    ...(process.argv.includes('--all') || process.argv.includes('--evidence') ? { tests, requirements } : {}),
  }, null, 2));
}
