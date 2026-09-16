import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSamples, validateSampleCoverage } from './statistics.mjs';

test('keeps environments/cache states separate and excludes only explicit warmup', () => {
  const sample = { project: 'webkit', metric: 'home', cacheState: 'new-document', label: '홈' };
  const result = summarizeSamples([
    ...[20, 40, 30, 10].map(durationMs => ({ ...sample, durationMs })),
    { ...sample, durationMs: 10000, warmup: true },
    { ...sample, durationMs: 5, cacheState: 'same-document' },
    { ...sample, durationMs: 50, project: 'chromium' },
  ]);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { ...sample, n: 4, minMs: 10, medianMs: 25, meanMs: 25, maxMs: 40, samplesMs: [20, 40, 30, 10] });
});

test('does not silently drop an invalid or failed timing sample', () => {
  assert.throws(() => summarizeSamples([{ durationMs: Number.NaN }]));
  assert.throws(() => summarizeSamples([{ durationMs: -1 }]));
  assert.throws(() => summarizeSamples([{ durationMs: Number.NaN, warmup: true }]));
});

const coverage = { projects: ['chromium', 'webkit'], metrics: ['home', 'save.server-confirmed'], samplesPerMetric: 7 };
function completeSamples(specification = coverage) {
  return specification.projects.flatMap(project => specification.metrics.flatMap(metric =>
    Array.from({ length: specification.samplesPerMetric + 1 }, (_, iteration) => ({
      project, metric, iteration, warmup: iteration === 0, durationMs: 10 + iteration, cacheState: 'persisted-auth',
    }))));
}

test('validates exactly seven observations plus one warmup for each selected project and metric', () => {
  assert.deepEqual(validateSampleCoverage(completeSamples(), coverage), []);
  const selected = { ...coverage, projects: ['webkit'], samplesPerMetric: 1 };
  assert.deepEqual(validateSampleCoverage(completeSamples(selected), selected), []);
  assert(validateSampleCoverage([], coverage).some(error => error.includes('Missing performance sample')));
  assert(validateSampleCoverage([], { ...coverage, projects: [] }).some(error => error.includes('Invalid')));
});

test('rejects missing metrics and duplicate iterations even when the total sample count is unchanged', () => {
  const samples = completeSamples();
  samples[2] = { ...samples[1] };
  const errors = validateSampleCoverage(samples, coverage);
  assert(errors.some(error => error.includes('Duplicate performance sample') && error.includes('"home",1')));
  assert(errors.some(error => error.includes('Missing performance sample') && error.includes('"home",2')));
  const omitted = completeSamples().filter(sample => sample.metric !== 'save.server-confirmed');
  assert(validateSampleCoverage(omitted, coverage).some(error => error.includes('save.server-confirmed')));
});

test('does not replace a measured iteration with warmup or allow missing preparation observations', () => {
  const samples = completeSamples();
  samples[3].warmup = true;
  assert(validateSampleCoverage(samples, coverage).some(error => error.includes('Incorrect warmup classification')));
  assert(validateSampleCoverage(completeSamples().filter(sample => !sample.warmup), coverage)
    .some(error => error.includes('Missing performance sample') && error.endsWith(',0]')));
});

test('rejects unselected projects, undeclared metrics, extra iterations, and mixed cache conditions', () => {
  for (const replacement of [{ project: 'other' }, { metric: 'unmeasured' }, { iteration: 8 }]) {
    const samples = completeSamples();
    samples[1] = { ...samples[1], ...replacement };
    assert(validateSampleCoverage(samples, coverage).some(error => error.includes('Unexpected performance sample')));
  }
  const mixed = completeSamples();
  mixed[1].cacheState = 'cold';
  assert(validateSampleCoverage(mixed, coverage).some(error => error.includes('Mixed cache conditions')));
});

test('retains a valid slow outlier in all seven observations while excluding only the recorded warmup', () => {
  const specification = { projects: ['android'], metrics: ['home'], samplesPerMetric: 7 };
  const samples = completeSamples(specification);
  samples[0].durationMs = 100_000;
  samples[7].durationMs = 50_700;
  assert.deepEqual(validateSampleCoverage(samples, specification), []);
  const [statistics] = summarizeSamples(samples);
  assert.equal(statistics.n, 7);
  assert.equal(statistics.medianMs, 14);
  assert.equal(statistics.maxMs, 50_700);
  assert.equal(statistics.meanMs, (11 + 12 + 13 + 14 + 15 + 16 + 50_700) / 7);
  assert.deepEqual(statistics.samplesMs, [11, 12, 13, 14, 15, 16, 50_700]);
  samples[0].durationMs = -1;
  assert(validateSampleCoverage(samples, specification).some(error => error.includes('Invalid performance duration')));
});
