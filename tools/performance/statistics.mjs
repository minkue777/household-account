export function summarizeSamples(samples) {
  const groups = new Map();
  for (const sample of samples) {
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) throw new Error('Invalid performance duration');
    if (sample.warmup) continue;
    const key = JSON.stringify([sample.project, sample.metric, sample.cacheState]);
    const group = groups.get(key) ?? { project: sample.project, metric: sample.metric, label: sample.label ?? sample.metric, cacheState: sample.cacheState, values: [] };
    group.values.push(sample.durationMs);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ values, ...group }) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return { ...group, n: values.length, minMs: sorted[0], medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
      meanMs: values.reduce((sum, value) => sum + value, 0) / values.length, maxMs: sorted.at(-1), samplesMs: values };
  });
}

/** Every selected project must report each declared metric once for warmup and each measured iteration. */
export function validateSampleCoverage(samples, { projects, metrics, samplesPerMetric }) {
  const errors = [];
  if (!Array.isArray(projects) || projects.length === 0 || new Set(projects).size !== projects.length
    || !Array.isArray(metrics) || metrics.length === 0 || new Set(metrics).size !== metrics.length
    || [...projects, ...metrics].some(value => typeof value !== 'string' || value.length === 0)
    || !Number.isInteger(samplesPerMetric) || samplesPerMetric < 1 || samplesPerMetric > 30) {
    return ['Invalid performance coverage specification'];
  }
  const seen = new Set();
  const cacheStates = new Map();
  for (const sample of samples) {
    const key = JSON.stringify([sample?.project, sample?.metric, sample?.iteration]);
    if (!projects.includes(sample?.project) || !metrics.includes(sample?.metric)
      || !Number.isInteger(sample?.iteration) || sample.iteration < 0 || sample.iteration > samplesPerMetric) {
      errors.push(`Unexpected performance sample: ${key}`);
      continue;
    }
    if (seen.has(key)) errors.push(`Duplicate performance sample: ${key}`);
    seen.add(key);
    if (sample.warmup !== (sample.iteration === 0)) errors.push(`Incorrect warmup classification: ${key}`);
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) errors.push(`Invalid performance duration: ${key}`);
    const metricKey = JSON.stringify([sample.project, sample.metric]);
    if (typeof sample.cacheState !== 'string' || sample.cacheState.length === 0) errors.push(`Missing cache condition: ${key}`);
    else if (cacheStates.has(metricKey) && cacheStates.get(metricKey) !== sample.cacheState) errors.push(`Mixed cache conditions: ${metricKey}`);
    else cacheStates.set(metricKey, sample.cacheState);
  }
  for (const project of projects) for (const metric of metrics) {
    for (let iteration = 0; iteration <= samplesPerMetric; iteration += 1) {
      const key = JSON.stringify([project, metric, iteration]);
      if (!seen.has(key)) errors.push(`Missing performance sample: ${key}`);
    }
  }
  return errors;
}

export function markdownTable(statistics) {
  return ['| 환경 | 동작 | 캐시 조건 | n | 최소 ms | 중앙값 ms | 평균 ms | 최대 ms |', '|---|---|---|---:|---:|---:|---:|---:|',
    ...statistics.map(row => `| ${row.project} | ${row.label} | ${row.cacheState} | ${row.n} | ${row.minMs.toFixed(1)} | ${row.medianMs.toFixed(1)} | ${row.meanMs.toFixed(1)} | ${row.maxMs.toFixed(1)} |`)].join('\n');
}
