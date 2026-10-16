import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, markdown } from '../scripts/report-results.mjs';

const outcome = (passed = true) => ({
  status: 'success', stimulus: 'case-a',
  gradeResult: { passed, score: passed ? 1 : 0, details: [] }
});
const expected = new Set(['case-a']);

test('valid failing behavioral verdicts remain report-only and visible', () => {
  const summary = summarize([outcome(false)], expected);
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.rows[0].status, 'BEHAVIORAL FAILURE');
  assert.match(markdown(summary, 'run-123'), /BEHAVIORAL FAILURE/);
});

test('successful results retain their score and saved-run identity', () => {
  const summary = summarize([outcome()], expected);
  assert.equal(summary.rows[0].status, 'PASS');
  assert.match(markdown(summary, 'run-123'), /run-123/);
});

test('execution, nested grader errors, and skips are not valid behavioral failures', () => {
  for (const record of [
    { status: 'error', stimulus: 'case-a', error: 'authentication failed' },
    { status: 'skipped', stimulus: 'case-a', skipReason: 'unsupported executor' },
    { ...outcome(), gradeResult: { passed: false, score: 0, details: [{ status: 'error', evidence: 'invalid grader' }] } },
    { status: 'success', stimulus: 'case-a', gradeResult: null }
  ]) assert.equal(summarize([record], expected).errors.length, 1);
});

test('empty, malformed, unknown, and partial result sets cannot report completion', () => {
  assert.throws(() => summarize([], expected), /nothing was evaluated/);
  assert.throws(() => summarize([{ ...outcome(), status: 'unknown' }], expected), /Invalid outcome/);
  assert.throws(() => summarize([{ ...outcome(), stimulus: 'not-in-suite' }], expected), /Unexpected/);
  assert.throws(() => summarize([{ ...outcome(), gradeResult: { passed: 'false', score: 1 } }], expected), /Invalid grade/);
  assert.equal(summarize([outcome()], new Set(['case-a', 'case-b'])).errors.length, 1);
});

test('the pinned saved-results stream contains trial-result rows and a run-summary footer', () => {
  const trial = { ...outcome(), type: 'trial-result', runId: 'run-a' };
  const footer = { type: 'run-summary', runId: 'run-a', passed: true, hadExecutionErrors: false };
  assert.equal(summarize([trial, footer], expected).rows.length, 1);
  assert.equal(summarize([trial, { ...footer, hadExecutionErrors: true }], expected).errors.length, 1);
  assert.throws(() => summarize([footer], expected), /nothing was evaluated/);
  assert.throws(() => summarize([{ ...trial, type: 'unrecognized' }], expected), /Unknown result record type/);
});
