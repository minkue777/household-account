import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { createPortfolioHouseholdCommandHandlers } from '../../src/bootstrap/commands/portfolioHouseholdCommandHandlers';
import { InMemoryFirestore } from '../support/in-memory-firestore';

const root = resolve(__dirname, '../../..');
const demoEntry = /(?:create|seed|add|generate|remove|delete)(?:Demo|Sample)(?:Assets?|Portfolio)|portfolio\.(?:demo|sample|seed-demo|seed-sample)|(?:샘플|데모)\s*자산/u;

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['__tests__', 'test', 'node_modules'].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? productionFiles(path)
      : ['.ts', '.tsx', '.js', '.mjs', '.kt', '.ps1'].includes(extname(path)) ? [path] : [];
  });
}

describe('Portfolio production demo 진입점 격리', () => {
  it('[T-AST-003][AST-007] 실제 등록 handler와 배포 계약에는 demo 생성 명령이 없다', () => {
    const memory = new InMemoryFirestore();
    const commands = Array.from(createPortfolioHouseholdCommandHandlers(memory as unknown as Firestore).keys());
    const manifest = readFileSync(resolve(root, 'contracts/fixtures/system/household-command-manifest.v1.json'), 'utf8');
    expect(commands).toContain('portfolio.create-asset.v1');
    expect(commands.filter(command => /demo|sample|seed/i.test(command))).toEqual([]);
    for (const command of ['portfolio.seed-demo-assets.v1', 'portfolio.create-sample-assets.v1']) {
      expect(commands).not.toContain(command);
      expect(manifest).not.toContain(command);
    }
    expect(memory.paths('')).toEqual([]);
  });

  it('[T-AST-003][AST-007] production export·Web/Android UI·관리 migration 스크립트에 sample 자산 진입점이 없다', () => {
    const roots = ['functions/src', 'functions/scripts', 'tools/operations', 'web/src', 'android/app/src/main/java'];
    const demoRoot = `${resolve(root, 'functions/src/demo')}/`.replace(/\\/g, '/');
    const files = roots.flatMap(directory => productionFiles(resolve(root, directory)))
      .filter(path => !path.replace(/\\/g, '/').startsWith(demoRoot));
    files.push(resolve(root, 'functions-payment-capture/index.js'), resolve(root, 'functions-access-session/index.js'));
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter(path => demoEntry.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path))).toEqual([]);
    expect(files.filter(path => readFileSync(path, 'utf8').includes('demo-asset-fixture-boundary-driver'))
      .map(path => relative(root, path))).toEqual([]);
    expect(files.filter(path => /(?:from|import|require)\s*(?:\(\s*)?["'][^"']*\/demo\//u.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path))).toEqual([]);
  });
});
