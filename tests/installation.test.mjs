import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { projectRoot } from '../scripts/inventory.mjs';

test('each workflow installs independently through the actual Copilot marketplace commands', { timeout: 120000 }, async () => {
  const catalog = JSON.parse(await readFile(resolve(projectRoot, '.github/plugin/marketplace.json'), 'utf8'));
  const loader = resolve(projectRoot, 'node_modules/@github/copilot/npm-loader.js');
  for (const plugin of catalog.plugins) {
    const home = await mkdtemp(join(tmpdir(), 'marketplace install '));
    const env = {
      ...process.env,
      COPILOT_HOME: home,
      COPILOT_CACHE_HOME: join(home, 'cache'),
      COPILOT_AUTO_UPDATE: 'false',
      NO_COLOR: '1'
    };
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN', 'GITHUB_COPILOT_API_TOKEN']) delete env[name];
    const run = args => {
      const result = spawnSync(process.execPath, [loader, ...args], {
        cwd: projectRoot, env, encoding: 'utf8', timeout: 30000, windowsHide: true
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    };
    try {
      const before = JSON.parse(run(['plugin', 'list', '--json']));
      assert.equal(before.filter(item => item.marketplace === catalog.name).length, 0,
        'The temporary client must not inherit installations from this marketplace');
      run(['plugin', 'marketplace', 'add', projectRoot]);
      run(['plugin', 'install', `${plugin.name}@${catalog.name}`]);
      const installed = JSON.parse(run(['plugin', 'list', '--json']));
      assert.ok(Array.isArray(installed), 'Expected the documented flat plugin list');
      const ours = installed.filter(item => item.marketplace === catalog.name && item.enabled);
      assert.deepEqual(ours.map(item => item.name), [plugin.name], 'A workflow must not install its sibling plugins');
      assert.equal(ours[0].enabled, true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
});
