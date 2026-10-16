import Ajv from 'ajv/dist/2020.js';
import { parseDocument } from 'yaml';
import { readFile, readdir, realpath, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ajv = new Ajv({ allErrors: true });
const pluginSchema = ajv.compile(JSON.parse(await readFile(resolve(projectRoot, 'schemas/plugin.schema.json'), 'utf8')));
const mcpSchema = ajv.compile(JSON.parse(await readFile(resolve(projectRoot, 'schemas/mcp.schema.json'), 'utf8')));
const githubSourceSchema = ajv.compile({
  type: 'object',
  required: ['source', 'repo'],
  additionalProperties: false,
  properties: {
    source: { const: 'github' },
    repo: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9-]*/(?!\\.{1,2}$)[A-Za-z0-9_.-]+$' },
    path: { type: 'string', minLength: 1, pattern: '^[^\\u0000-\\u001f\\u007f]+$' },
    ref: { type: 'string', minLength: 1, pattern: '\\S' },
    sha: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' }
  }
});
const slug = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const validName = value => typeof value === 'string' && value.length <= 64 && slug.test(value);

export function validateRemoteSource(source, label = 'Remote plugin') {
  if (!githubSourceSchema(source)) throw new Error(`${label}: invalid GitHub source: ${ajv.errorsText(githubSourceSchema.errors)}`);
  if (source.path !== undefined && (
    /[\\:]/.test(source.path) ||
    source.path.split('/').some(part => !part || part === '.' || part === '..')
  )) throw new Error(`${label}: remote path must be a canonical repository-relative directory`);
  return source;
}

export function parseYaml(text, label) {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label}: ${document.errors.map(error => error.message).join('; ')}`);
  return document.toJS();
}

export function frontmatter(text, label) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${label}: missing YAML frontmatter`);
  const data = parseYaml(match[1], label);
  if (!data || typeof data.name !== 'string' || !slug.test(data.name) || data.name.length > 64 ||
      typeof data.description !== 'string' || !data.description.trim()) {
    throw new Error(`${label}: a valid name and nonempty description are required`);
  }
  if (!text.slice(match[0].length).trim()) throw new Error(`${label}: instructions are empty`);
  return data;
}

export async function contained(root, path) {
  const base = await realpath(root);
  const target = await realpath(resolve(root, path));
  const rel = relative(base, target);
  if (isAbsolute(rel) || rel.split(sep).includes('..')) throw new Error(`Path escapes package: ${path}`);
  return target;
}

async function entries(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function listMcpTools(pluginRoot, server) {
  if (server.type !== 'stdio') throw new Error('This template only permits local stdio MCP servers.');
  const data = await mkdtemp(join(tmpdir(), 'marketplace-mcp-data-'));
  const expand = value => value.replaceAll('${PLUGIN_ROOT}', pluginRoot).replaceAll('${PLUGIN_DATA}', data);
  const configuredCwd = server.cwd ?? '${PLUGIN_ROOT}';
  const cwd = configuredCwd.startsWith('${PLUGIN_DATA}')
    ? await contained(data, expand(configuredCwd))
    : await contained(pluginRoot, expand(configuredCwd));
  const command = server.command.startsWith('./') ? await contained(pluginRoot, server.command) : server.command;
  if (!server.command.startsWith('./') && !/^[\w.-]+$/.test(command)) {
    throw new Error('MCP command must be a bare executable or a contained ./ path.');
  }
  const transport = new StdioClientTransport({
    command,
    args: (server.args ?? []).map(expand),
    cwd,
    env: {
      ...getDefaultEnvironment(),
      ...Object.fromEntries(Object.entries(server.env ?? {}).map(([key, value]) => [key, expand(value)])),
      PLUGIN_ROOT: pluginRoot,
      PLUGIN_DATA: data
    },
    stderr: 'inherit'
  });
  const client = new Client({ name: 'marketplace-inventory', version: '0.1.0' });
  try {
    await client.connect(transport, { timeout: 10000 });
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 10000 });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    if (!tools.length) throw new Error(`MCP server in ${pluginRoot} advertises no tools`);
    return tools;
  } finally {
    try { await client.close(); }
    finally {
      try { await transport.close(); }
      finally { await rm(data, { recursive: true, force: true }); }
    }
  }
}

export async function inventory(root = projectRoot) {
  const catalog = JSON.parse(await readFile(resolve(root, '.github/plugin/marketplace.json'), 'utf8'));
  if (!validName(catalog.name) || typeof catalog.owner?.name !== 'string' || !catalog.owner.name.trim() ||
      !Array.isArray(catalog.plugins) || !catalog.plugins.length) {
    throw new Error('Marketplace needs a valid name, owner, and nonempty plugin list');
  }
  const assets = [];
  const localPlugins = [];
  const remotePlugins = [];
  const names = new Set();
  const sources = new Set();
  for (const entry of catalog.plugins) {
    if (!validName(entry.name) || names.has(entry.name)) throw new Error(`Invalid/duplicate plugin: ${entry.name}`);
    names.add(entry.name);
    if (typeof entry.source !== 'string') {
      validateRemoteSource(entry.source, entry.name);
      remotePlugins.push(entry);
      continue;
    }
    if (!entry.source.startsWith('./plugins/') || entry.source.includes('\\')) {
      throw new Error(`${entry.name}: local sources must use ./plugins/ paths; remote sources need a GitHub source object`);
    }
    localPlugins.push(entry);
    const dir = await contained(root, entry.source);
    if (sources.has(dir)) throw new Error(`Duplicate plugin source: ${entry.source}`);
    sources.add(dir);
    const manifestPath = await contained(dir, 'plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!pluginSchema(manifest)) throw new Error(`${entry.name}: ${ajv.errorsText(pluginSchema.errors)}`);
    if (manifest.name !== entry.name || manifest.version !== entry.version) throw new Error(`${entry.name}: catalog/manifest identity drift`);
    const before = assets.length;
    for (const child of await entries(resolve(dir, 'skills'))) {
      if (!child.isDirectory() && !child.isSymbolicLink()) continue;
      const file = await contained(dir, `skills/${child.name}/SKILL.md`);
      const skill = frontmatter(await readFile(file, 'utf8'), file);
      if (skill.name !== child.name) throw new Error(`${file}: skill name must match its directory`);
      assets.push({ id: `skill:${entry.name}/${skill.name}`, kind: 'skill', name: skill.name, path: dirname(file) });
    }
    for (const child of await entries(resolve(dir, 'com.github.copilot/agents'))) {
      if (!child.name.endsWith('.agent.md')) continue;
      const file = await contained(dir, `com.github.copilot/agents/${child.name}`);
      const agent = frontmatter(await readFile(file, 'utf8'), file);
      assets.push({ id: `agent:${entry.name}/${agent.name}`, kind: 'agent', name: agent.name, path: file });
    }
    const mcpEntries = await entries(dir);
    if (mcpEntries.some(file => file.name === 'mcp.json')) {
      const config = JSON.parse(await readFile(await contained(dir, 'mcp.json'), 'utf8'));
      if (!mcpSchema(config)) throw new Error(`${entry.name}: ${ajv.errorsText(mcpSchema.errors)}`);
      for (const [serverName, server] of Object.entries(config.mcpServers)) {
        for (const tool of await listMcpTools(dir, server)) {
          assets.push({ id: `mcp:${entry.name}/${serverName}/${tool.name}`, kind: 'mcp', name: tool.name, serverName, path: dir });
        }
      }
    }
    if (assets.length === before) throw new Error(`${entry.name}: plugin has no supported assets`);
  }
  for (const child of await entries(resolve(root, 'plugins'))) {
    if (child.isDirectory() && !sources.has(await realpath(resolve(root, 'plugins', child.name)))) {
      throw new Error(`Plugin missing from marketplace: ${child.name}`);
    }
  }
  if (new Set(assets.map(asset => asset.id)).size !== assets.length) throw new Error('Duplicate asset identity');
  return { catalog, assets, localPlugins, remotePlugins };
}
