import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);

/** One-time rebuild. Runtime never falls back to scanning historical runs. */
export async function backfillScheduledJobStatuses(database, { definitions, apply = false, projection } = {}) {
  const policy = projection ?? require('../lib/adapters/firebase/operations/scheduledJobStatusSummary.js');
  const jobs = definitions ?? require('../lib/operations/scheduling/scheduledJobDefinitions.js').loadScheduledJobDefinitions().definitions;
  const operations = database.collection('operations').doc('runtime');
  const rows = [];
  for (const { jobName } of jobs) {
    const collect = async transaction => {
      const read = reference => transaction ? transaction.get(reference) : reference.get();
      const reference = policy.scheduledJobStatusSummaryReference(database, jobName);
      const previous = policy.readScheduledJobStatusSummary((await read(reference)).data());
      const source = jobName === 'scheduled-job-monitor'
        ? operations.collection('scheduledJobMonitorReceipts').orderBy('terminalAt', 'desc').limit(1)
        : operations.collection('scheduledJobRuns').where('jobName', '==', jobName);
      const records = await read(source);
      let next = previous;
      for (const record of records.docs) {
        const data = record.data();
        const candidate = policy.scheduledJobStatus(jobName === 'scheduled-job-monitor'
          ? { occurrenceId: record.id, jobName, status: 'COMPLETE', scheduledFor: data.terminalAt, terminalAt: data.terminalAt }
          : { ...data, occurrenceId: record.id });
        if (candidate) next = policy.advanceScheduledJobStatusSummary(next, candidate);
      }
      const changed = next !== undefined && JSON.stringify(previous) !== JSON.stringify(next);
      if (transaction && changed) transaction.set(reference, next);
      return { jobName, sourceCount: records.size, changed, status: next?.latestRun.status ?? 'UNKNOWN' };
    };
    // Query and summary are read together in the write transaction. A concurrent
    // job completion forces retry, rather than replacing a newer live summary.
    rows.push(apply ? await database.runTransaction(collect) : await collect());
  }
  return { mode: apply ? 'applied' : 'plan', changed: rows.filter(row => row.changed).length, jobs: rows };
}

async function main() {
  const position = process.argv.indexOf('--project');
  const project = position < 0 ? undefined : process.argv[position + 1];
  if (!project || (!process.env.FIRESTORE_EMULATOR_HOST && project !== 'household-account-6f300')) throw new Error('PROJECT_REQUIRED');
  const app = initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  try { console.log(JSON.stringify(await backfillScheduledJobStatuses(getFirestore(app), { apply: process.argv.includes('--apply') }))); }
  finally { await deleteApp(app); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
