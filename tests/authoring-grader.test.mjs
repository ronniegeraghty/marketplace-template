import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gradeAuthoring } from '../evals/graders/dist/authoring.mjs';

test('the actual relocated grader rejects missing, malformed, and invocation-only artifacts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'marketplace grader test '));
  try {
    assert.equal((await gradeAuthoring(dir)).passed, false);
    await mkdir(join(dir, 'skills/change-summary'), { recursive: true });
    await mkdir(join(dir, 'evals/change-summary'), { recursive: true });
    const skill = join(dir, 'skills/change-summary/SKILL.md');
    const spec = join(dir, 'evals/change-summary/eval.yaml');
    await writeFile(skill, 'not frontmatter');
    await writeFile(spec, 'name: sample');
    assert.equal((await gradeAuthoring(dir)).passed, false);
    await writeFile(skill, '---\nname: change-summary\ndescription: Summarize changes.\n---\nRead changes.txt and write summary.json.');
    await writeFile(spec, `name: generated-test
agent_environment:
  skills: [../../skills/change-summary]
stimuli:
  - name: task-case
    prompt: Summarize changes.txt.
    graders:
      - type: skill-invocation
        config:
          required: [change-summary]
  - name: non-trigger
    prompt: What is the capital of France?
    graders:
      - type: skill-invocation
        config:
          disallowed: [change-summary]
`);
    assert.match((await gradeAuthoring(dir)).evidence, /outcome assertions/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
