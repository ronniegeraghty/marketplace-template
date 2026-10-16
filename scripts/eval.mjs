import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { resolve, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cliDir = resolve(root, 'node_modules/@microsoft/vally-cli');
const cli = JSON.parse(await readFile(resolve(cliDir, 'package.json'), 'utf8'));
const runtime = resolve(root, 'node_modules/@github/copilot/npm-loader.js');
export const vallyCliPath = resolve(cliDir, typeof cli.bin === 'string' ? cli.bin : cli.bin.vally);
export const jsonMcpServerPath = resolve(root, 'plugins/json-configuration/dist/server.mjs');

export function runtimeEnvironment(base = process.env) {
  const env = { ...base };
  const pathKey = Object.keys(base).find(key => key.toLowerCase() === 'path');
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  return {
    ...env,
    PATH: [resolve(root, 'node_modules/.bin'), pathKey ? base[pathKey] : ''].filter(Boolean).join(delimiter),
    COPILOT_CLI_PATH: runtime,
    MARKETPLACE_VALLY_CLI: vallyCliPath,
    VALLY_TELEMETRY_OPTOUT: '1'
  };
}

async function main() {
  await access(runtime);
  await access(jsonMcpServerPath);
  const args = process.argv.slice(2);
  const command = args[0] === 'grade' ? args.shift() : 'eval';
  const defaults = command === 'eval'
    ? ['--workers', '2', '--max-retries', '0', '--junit', '--output-dir', 'vally-results']
    : [];
  const child = spawn(process.execPath, [
    vallyCliPath, command, ...defaults,
    '--param', `JSON_MCP_SERVER=${jsonMcpServerPath}`, ...args
  ], { cwd: root, stdio: 'inherit', env: runtimeEnvironment() });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    if (signal) console.error(`Vally terminated by ${signal}`);
    process.exitCode = code ?? 1;
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
