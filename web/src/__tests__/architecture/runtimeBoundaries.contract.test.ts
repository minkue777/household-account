import fs from 'node:fs';
import path from 'node:path';

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(fullPath);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Web runtime architecture boundary', () => {
  const srcRoot = path.join(process.cwd(), 'src');

  test('Firebase Firestore SDK는 초기화와 read-only adapter 밖으로 새지 않는다', () => {
    const violations = sourceFiles(srcRoot)
      .filter((file) => fs.readFileSync(file, 'utf8').includes('firebase/firestore'))
      .map((file) => path.relative(srcRoot, file).replaceAll('\\', '/'))
      .filter((file) => ![
        'lib/firebase.ts',
        'platform/read-model/firestoreReadModel.ts',
      ].includes(file));

    expect(violations).toEqual([]);
  });

  test('Web production source는 Firestore writer API와 legacy guest tenant를 사용하지 않는다', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      const source = withoutComments(fs.readFileSync(file, 'utf8'));
      if (/\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/.test(source)) {
        violations.push(path.relative(srcRoot, file).replaceAll('\\', '/'));
      }
      if (/\|\|\s*['"]guest['"]/.test(source) || source.includes('getStoredHouseholdKey')) {
        violations.push(path.relative(srcRoot, file).replaceAll('\\', '/'));
      }
    }
    expect(Array.from(new Set(violations))).toEqual([]);
  });

  test('localStorage의 legacy 신원은 전용 migration adapter만 읽는다', () => {
    const identityReads = sourceFiles(srcRoot)
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return source.includes('HouseholdStorage.get(') || source.includes('MemberStorage.getMember');
      })
      .map((file) => path.relative(srcRoot, file).replaceAll('\\', '/'));

    expect(identityReads).toEqual([
      'features/access-household/application/legacySessionCandidate.ts',
    ]);
  });

  test('Web command 계약은 canonical manifest의 Web 명령과 정확히 일치한다', () => {
    const manifest = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), '../contracts/fixtures/system/household-command-manifest.v1.json'),
      'utf8'
    )) as { commands: Array<{ name: string; clients: string[] }> };
    const contractSource = fs.readFileSync(
      path.join(srcRoot, 'platform/functions-api/householdCommandContract.ts'),
      'utf8'
    );
    const declared = new Set(
      Array.from(contractSource.matchAll(/^\s*'([^']+\.v1)':/gm)).map((match) => match[1])
    );
    const expected = manifest.commands
      .filter((command) => command.clients.includes('web'))
      .map((command) => command.name)
      .sort();

    expect(Array.from(declared).sort()).toEqual(expected);
  });

  test('FCM Web 등록은 deprecated getToken이 아닌 FID lifecycle API만 사용한다', () => {
    const messagingSources = sourceFiles(srcRoot)
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    expect(messagingSources).not.toMatch(/\bgetToken\b/);
    expect(messagingSources).toMatch(/\bonRegistered\b/);
    expect(messagingSources).toMatch(/\bregister\b/);
  });
});
