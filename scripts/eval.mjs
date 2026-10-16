import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cliDir = resolve(root, 'node_modules/@microsoft/vally-cli');
const cli = JSON.parse(await readFile(resolve(cliDir, 'package.json'), 'utf8'));
const runtime = resolve(root, 'node_modules/@github/copilot/npm-loader.js');
await access(runtime);
const child = spawn(process.execPath, [
  resolve(cliDir, typeof cli.bin === 'string' ? cli.bin : cli.bin.vally),
  'eval', '--workers', '2', '--max-retries', '0', '--junit',
  '--output-dir', 'vally-results', ...process.argv.slice(2)
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, COPILOT_CLI_PATH: runtime, VALLY_TELEMETRY_OPTOUT: '1' }
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (signal) console.error(`Vally terminated by ${signal}`);
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
