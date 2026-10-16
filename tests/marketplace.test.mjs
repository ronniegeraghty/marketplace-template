import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inventory, projectRoot, frontmatter, contained, parseYaml, validateRemoteSource } from '../scripts/inventory.mjs';
import { readEvals, checkCoverage } from '../scripts/coverage.mjs';

test('catalog discovery and evals cover the real skills, agent, and both advertised MCP tools', async () => {
  const { assets, catalog, localPlugins, remotePlugins } = await inventory();
  assert.equal(catalog.plugins.length, 4);
  assert.equal(localPlugins.length, 3);
  assert.equal(remotePlugins.length, 1);
  assert.equal(remotePlugins[0].name, 'evals');
  assert.deepEqual(remotePlugins[0].source, { source: 'github', repo: 'github/evals', path: 'packages/plugin' });
  assert.deepEqual(assets.map(asset => asset.kind).sort(), ['agent', 'mcp', 'mcp', 'skill', 'skill', 'skill']);
  await checkCoverage(assets, await readEvals(projectRoot));
});

test('coverage rejects missing, unknown, unloaded, invocation-free, and negative-free cases', async () => {
  const { assets } = await inventory();
  const specs = await readEvals(projectRoot);
  const author = specs.find(item => item.spec.name === 'customization-authoring');
  const only = assets.filter(asset => asset.id === 'skill:customization-authoring/skill-authoring');
  const modify = mutate => {
    const copy = structuredClone(author);
    mutate(copy.spec);
    return [copy];
  };
  await assert.rejects(checkCoverage(only, []), /missing invocation/);
  await assert.rejects(checkCoverage(only, modify(spec => { spec.stimuli[0].tags.assets = 'skill:unknown'; })), /unknown asset/);
  await assert.rejects(checkCoverage(only, modify(spec => { spec.agent_environment.skills = []; })), /isn't loaded/);
  await assert.rejects(checkCoverage(only, modify(spec => { spec.stimuli[0].graders = [{ type: 'output-contains', config: { substring: 'ok' } }]; })), /missing invocation/);
  await assert.rejects(checkCoverage(only, modify(spec => { spec.stimuli = [spec.stimuli[0]]; })), /negative control/);
  await assert.rejects(checkCoverage(only, modify(spec => { spec.stimuli[0].tags.suite = 'full'; })), /PR smoke/);
});

test('a relocated template has no source-checkout or root node_modules dependency', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'marketplace copied template '));
  try {
    await mkdir(join(dir, '.github/plugin'), { recursive: true });
    await cp(join(projectRoot, '.github/plugin/marketplace.json'), join(dir, '.github/plugin/marketplace.json'));
    await cp(join(projectRoot, 'plugins'), join(dir, 'plugins'), { recursive: true });
    const { assets } = await inventory(dir);
    assert.equal(assets.filter(asset => asset.kind === 'mcp').length, 2);
    await assert.rejects(contained(dir, '..'), /escapes/);
    const path = join(dir, '.github/plugin/marketplace.json');
    const catalog = JSON.parse(await readFile(path, 'utf8'));
    catalog.plugins[0].source = { source: 'url', url: 'https://example.com/plugin.git' };
    await writeFile(path, JSON.stringify(catalog));
    await assert.rejects(inventory(dir), /invalid GitHub source/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('remote sources validate metadata without requiring an upstream checkout', () => {
  for (const source of [
    { source: 'github', repo: 'github/evals', path: 'packages/plugin' },
    { source: 'github', repo: 'example/plugin', ref: 'main' },
    { source: 'github', repo: 'example/plugin', sha: 'a'.repeat(40) }
  ]) assert.equal(validateRemoteSource(source), source);
  for (const source of [
    null, [], { source: 'github' },
    { source: 'url', repo: 'github/evals' },
    { source: 'github', repo: 'https://github.com/github/evals' },
    { source: 'github', repo: 'github/..' },
    { source: 'github', repo: 'github/evals', sha: 'main' },
    { source: 'github', repo: 'github/evals', ref: ' ' },
    { source: 'github', repo: 'github/evals', unsupported: true }
  ]) assert.throws(() => validateRemoteSource(source), /invalid GitHub source/);
  for (const path of ['/packages/plugin', '../plugin', 'packages/../plugin', './plugin', 'packages\\plugin', 'C:/plugin', 'packages//plugin']) {
    assert.throws(() => validateRemoteSource({ source: 'github', repo: 'github/evals', path }), /repository-relative/);
  }
});

test('remote references do not replace local coverage or hide uncatalogued local plugins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'marketplace remote metadata '));
  try {
    await mkdir(join(dir, '.github/plugin'), { recursive: true });
    const catalog = JSON.parse(await readFile(join(projectRoot, '.github/plugin/marketplace.json'), 'utf8'));
    const remote = catalog.plugins.find(plugin => plugin.name === 'evals');
    catalog.plugins = [remote];
    const path = join(dir, '.github/plugin/marketplace.json');
    await writeFile(path, JSON.stringify(catalog));
    const result = await inventory(dir);
    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.localPlugins, []);
    assert.deepEqual(result.remotePlugins, [remote]);
    catalog.plugins.push(remote);
    await writeFile(path, JSON.stringify(catalog));
    await assert.rejects(inventory(dir), /duplicate plugin/);
    catalog.plugins = [remote];
    await writeFile(path, JSON.stringify(catalog));
    await mkdir(join(dir, 'plugins/uncatalogued'), { recursive: true });
    await assert.rejects(inventory(dir), /Plugin missing from marketplace/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('malformed frontmatter and duplicate YAML keys are rejected', () => {
  assert.throws(() => frontmatter('no header', 'skill'), /frontmatter/);
  assert.throws(() => frontmatter('---\nname: Valid\n---\ntext', 'skill'), /valid name/);
  assert.throws(() => parseYaml('name: first\nname: second', 'fixture'), /unique|Map keys/);
});

test('CI actually runs evals on trusted code and keeps credentials out of fork checks', async () => {
  const checks = parseYaml(await readFile(resolve(projectRoot, '.github/workflows/checks.yml'), 'utf8'), 'checks');
  const evals = parseYaml(await readFile(resolve(projectRoot, '.github/workflows/evals.yml'), 'utf8'), 'evals');
  assert.deepEqual(checks.permissions, { contents: 'read' });
  assert.ok(!('pull_request_target' in evals.on));
  assert.match(evals.jobs.evaluate.if, /head\.repo\.full_name == github\.repository/);
  assert.equal(evals.jobs.evaluate.permissions['copilot-requests'], 'write');
  const run = evals.jobs.evaluate.steps.find(step => step.id === 'evaluate');
  assert.match(run.run, /scripts\/eval\.mjs --suite/);
  assert.match(run.run, /--workers 1/);
  assert.equal(run.env.GITHUB_TOKEN, '${{ github.token }}');
  assert.ok(evals.jobs.evaluate.steps.some(step => step.run?.includes('eval:report')));
  for (const step of evals.jobs.evaluate.steps) assert.equal(step['continue-on-error'], undefined);
  const launcher = await readFile(resolve(projectRoot, 'scripts/eval.mjs'), 'utf8');
  assert.match(launcher, /COPILOT_CLI_PATH/);
  assert.doesNotMatch(launcher, /'--require-pass'/);
});
