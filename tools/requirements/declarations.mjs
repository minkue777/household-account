import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export function parseRequirementTable(source) {
  let inRequirements = false;
  const entries = [];
  for (const line of source.split(/\r?\n/)) {
    if (/^## /.test(line)) inRequirements = /^## (?:5\. 요구사항|6\. 공통 요구사항)\s*$/.test(line);
    if (!inRequirements) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(value => value.trim());
    const id = cells[0]?.match(/^\[?((?!T-)[A-Z][A-Z0-9-]*-\d{3})(?:\]\([^)]+\))?$/)?.[1];
    if (id) entries.push({ id, status: cells[1], row: line.slice(line.indexOf('|', 1) + 1).trim() });
  }
  return entries;
}

export function readDeclarations(root) {
  const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
  const markdown = walk(root).filter(file => file.endsWith('.md')).sort();
  const sources = markdown.filter(file => {
    const path = relative(root, file).replaceAll('\\', '/');
    return /^(?:contexts\/[^/]+\/modules|supporting-platform\/modules)\/[^/]+\/requirements\.md$/.test(path) || path === 'system/context.md';
  });
  const tests = new Map();
  for (const file of markdown) for (const match of readFileSync(file, 'utf8').matchAll(/^\|\s*(T-[A-Z0-9-]+)\s*\|/gm)) {
    if (tests.has(match[1])) throw new Error(`Duplicate canonical test ID: ${match[1]}`);
    tests.set(match[1], file);
  }
  const requirements = sources.flatMap(file => parseRequirementTable(readFileSync(file, 'utf8')).map(entry => ({ ...entry, file })));
  const seen = new Set();
  for (const { id } of requirements) {
    if (seen.has(id)) throw new Error(`Duplicate requirement ID: ${id}`);
    seen.add(id);
  }
  return { markdown, sources, requirements, tests };
}
