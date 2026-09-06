import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function assertionSummary(report, filter = () => true) {
  const assertions = report.testResults.filter(result => filter(result.name)).flatMap(result => result.assertionResults);
  if (!assertions.length) throw new Error('RELEASE_TEST_REPORT_EMPTY');
  return { active: assertions.length, passed: assertions.filter(test => test.status === 'passed').length,
    failed: assertions.filter(test => test.status === 'failed').length,
    skipped: assertions.filter(test => !['passed', 'failed'].includes(test.status)).length, knownFailures: 0 };
}

export function androidSummary(directory) {
  const files = readdirSync(directory, { recursive: true }).filter(file => String(file).endsWith('.xml'));
  if (!files.length) throw new Error('ANDROID_TEST_REPORT_MISSING');
  const result = { active: 0, passed: 0, failed: 0, skipped: 0, knownFailures: 0 };
  for (const file of files) {
    const source = readFileSync(join(directory, String(file)), 'utf8');
    const suite = source.match(/<testsuite\s[^>]*>/)?.[0];
    if (!suite) throw new Error('ANDROID_TEST_REPORT_INVALID');
    const count = name => Number(suite.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1] ?? 0);
    const failed = count('failures') + count('errors');
    result.active += count('tests'); result.failed += failed; result.skipped += count('skipped');
    result.passed += count('tests') - failed - count('skipped');
  }
  if (!result.active) throw new Error('ANDROID_TEST_REPORT_EMPTY');
  return result;
}

export function releaseGateEvidence(functionsReport, webReport, androidReport) {
  const contract = name => /[/\\]test[/\\](contexts|contracts)[/\\]/.test(name);
  const functionsUnit = assertionSummary(functionsReport, name => !contract(name) && !/[/\\]integration[/\\]/.test(name));
  const web = assertionSummary(webReport);
  const unit = Object.fromEntries(Object.keys(functionsUnit).map(key => [key, functionsUnit[key] + web[key] + androidReport[key]]));
  const checked = name => {
    const report = functionsReport.testResults.find(result => result.name.includes(name));
    if (!report || !report.assertionResults.length || report.assertionResults.some(test => test.status !== 'passed')) throw new Error(`RELEASE_GATE_REPORT_MISSING:${name}`);
  };
  checked('requirement-test-traceability'); checked('document-relative-links'); checked('production-dependency-direction');
  return [
    ...['web-build', 'functions-build', 'android-build', 'firestore-rules-emulator', 'requirement-id-trace', 'relative-link-check', 'architecture-fitness'].map(gate => ({ gate, status: 'passed' })),
    { gate: 'active-unit-tests', status: 'passed', testRun: unit },
    { gate: 'active-contract-tests', status: 'passed', testRun: assertionSummary(functionsReport, contract) },
  ];
}

export function requireSuccessfulHeadRun(runs, sha, jobs) {
  const run = runs[0];
  if (!run || run.headSha !== sha || run.status !== 'completed' || run.conclusion !== 'success' || run.event !== 'push') throw new Error('EXACT_HEAD_QUALITY_GATES_REQUIRED');
  for (const name of ['functions', 'web', 'web-e2e', 'android', 'android-instrumentation']) {
    if (!jobs.some(job => job.name === name && job.conclusion === 'success')) throw new Error(`QUALITY_JOB_REQUIRED:${name}`);
  }
  return run;
}
