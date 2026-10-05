import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { parseRequirementTable, readDeclarations } from './declarations.mjs';

test('정확한 요구사항 영역의 표만 읽고 링크 ID·escaped pipe·CRLF를 보존한다', () => {
  assert.deepEqual(parseRequirementTable([
    '| IGNORED-001 | outside |', '## 5. 요구사항',
    '| [LED-001](reference.md) | 구현 | a \\| b |', '| T-LED-001 | 시나리오 |',
    '## 7. 다른 영역', '| IGNORED-002 | outside |',
    '## 6. 공통 요구사항', '| SYS-001 | 검증 | 원자성 |',
  ].join('\r\n')), [
    { id: 'LED-001', status: '구현', row: '구현 | a \\| b |' },
    { id: 'SYS-001', status: '검증', row: '검증 | 원자성 |' },
  ]);
});

test('요구사항 소유 문서만 집계하고 요구사항·테스트 ID 중복을 거부한다', () => {
  const root = mkdtempSync(join(tmpdir(), 'household-declarations-'));
  const put = (file, text) => { const target = join(root, file); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, text); };
  try {
    const body = '## 5. 요구사항\n| LED-001 | 구현 | 내용 |\n';
    put('contexts/finance/modules/ledger/requirements.md', body);
    put('notes/context.md', body);
    put('contexts/finance/modules/ledger/design.md', '| T-LED-001 | 실제 시나리오 |');
    assert.equal(readDeclarations(root).requirements.length, 1);
    assert.equal(readDeclarations(root).tests.size, 1);
    put('system/context.md', body.replace('5. 요구사항', '6. 공통 요구사항'));
    assert.throws(() => readDeclarations(root), /Duplicate requirement ID: LED-001/);
    put('system/context.md', '## 6. 공통 요구사항\n| SYS-001 | 구현 | 내용 |');
    put('notes/duplicate.md', '| T-LED-001 | 중복 시나리오 |');
    assert.throws(() => readDeclarations(root), /Duplicate canonical test ID: T-LED-001/);
  } finally {
    const path = relative(tmpdir(), root);
    assert(path.startsWith('household-declarations-') && !path.includes('..') && !isAbsolute(path));
    rmSync(root, { recursive: true });
  }
});
