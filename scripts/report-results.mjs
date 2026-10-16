import { readFile, readdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot } from './inventory.mjs';
import { readEvals } from './coverage.mjs';

const graderError = grade => grade?.status === 'error' || (grade?.details ?? []).some(graderError);
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function summarize(records, expected) {
  if (!records.length) throw new Error('No evaluation results: nothing was evaluated.');
  const seen = new Set();
  const errors = [];
  const rows = [];
  for (const record of records) {
    if (record.type === 'run-summary') {
      if (typeof record.hadExecutionErrors !== 'boolean') throw new Error('Invalid Vally run summary');
      if (record.hadExecutionErrors) errors.push('Vally reported execution errors for this run');
      continue;
    }
    if (record.type !== undefined && record.type !== 'trial-result') throw new Error(`Unknown result record type: ${record.type}`);
    const name = record.stimulus ?? record.trajectory?.stimulus?.name ?? record.gradeResult?.stimulusName;
    if (typeof name !== 'string' || !expected.has(name)) throw new Error(`Unexpected or missing stimulus identity: ${name}`);
    if (!['success', 'error', 'skipped'].includes(record.status)) throw new Error(`Invalid outcome status for ${name}`);
    seen.add(name);
    const grade = record.gradeResult;
    let status;
    if (record.status !== 'success' || !grade || graderError(grade)) {
      status = record.status === 'skipped' ? 'NOT EVALUATED' : 'ERROR';
      errors.push(`${name}: ${record.error ?? record.skipReason ?? 'execution or grading did not produce a valid verdict'}`);
    } else {
      if (typeof grade.passed !== 'boolean' || !Number.isFinite(grade.score) || grade.score < 0 || grade.score > 1) {
        throw new Error(`Invalid grade for ${name}`);
      }
      status = grade.passed ? 'PASS' : 'BEHAVIORAL FAILURE';
    }
    rows.push({ name, status, score: grade?.score, details: grade?.details ?? [] });
  }
  if (!rows.length) throw new Error('No evaluation results: nothing was evaluated.');
  for (const name of expected) if (!seen.has(name)) errors.push(`${name}: no result was recorded`);
  return { rows, errors };
}

export function markdown(summary, runDirectory) {
  const lines = [
    '## Behavioral evaluation results',
    '',
    `Saved run: \`${escape(runDirectory)}\``,
    '',
    'Behavioral failures are report-only. Errors, unexpected skips, and missing results fail this check.',
    '',
    '| Case | Outcome | Score |',
    '| --- | --- | --- |',
    ...summary.rows.map(row => `| ${escape(row.name)} | ${row.status} | ${Number.isFinite(row.score) ? `${(row.score * 100).toFixed(1)}%` : 'Not scored'} |`)
  ];
  const failures = summary.rows.flatMap(row => row.details.filter(detail => !detail.passed).map(detail =>
    `- ${escape(row.name)} / ${escape(detail.name)}: ${escape(detail.evidence)}`));
  if (failures.length) lines.push('', '### Failed checks', ...failures);
  if (summary.errors.length) lines.push('', '### Execution or coverage errors', ...summary.errors.map(error => `- ${escape(error)}`));
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const suite = value('--suite') ?? 'full';
  if (!['pr', 'full'].includes(suite)) throw new Error('Choose --suite pr or --suite full');
  let runDirectory = value('--run-dir');
  if (!runDirectory) {
    const directory = resolve(projectRoot, 'vally-results');
    const runs = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    if (!runs.length) throw new Error('No saved runs. Behavioral evaluations have not run.');
    runDirectory = resolve(directory, runs.at(-1));
  }
  const text = await readFile(resolve(runDirectory, 'results.jsonl'), 'utf8');
  const records = text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  if (records.at(-1)?.type !== 'run-summary') throw new Error('The saved run has no completion summary');
  const runIds = new Set(records.map(record => record.runId));
  if (runIds.size !== 1 || typeof records[0]?.runId !== 'string') throw new Error('Missing or mixed run identities');
  const expected = new Set();
  for (const { spec } of await readEvals(projectRoot)) {
    for (const stimulus of spec.stimuli) {
      const suites = Array.isArray(stimulus.tags?.suite) ? stimulus.tags.suite : [stimulus.tags?.suite];
      if (suite === 'full' || suites.includes('pr')) {
        if (expected.has(stimulus.name)) throw new Error(`Stimulus names must be unique for reporting: ${stimulus.name}`);
        expected.add(stimulus.name);
      }
    }
  }
  const summary = summarize(records, expected);
  const report = markdown(summary, runDirectory);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
  if (summary.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
