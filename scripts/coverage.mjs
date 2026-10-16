import { readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseYaml } from './inventory.mjs';

export async function readEvals(root) {
  const specs = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Eval symlinks aren't supported: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name === 'eval.yaml') specs.push({ path, spec: parseYaml(await readFile(path, 'utf8'), path) });
    }
  }
  await visit(resolve(root, 'evals'));
  if (!specs.length) throw new Error('No eval.yaml files discovered');
  return specs;
}

const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const matches = (pattern, value) => typeof pattern === 'string' && new RegExp(pattern).test(value);

function invoked(asset, graders) {
  if (asset.kind === 'skill') return graders.some(grader =>
    grader.type === 'skill-invocation' && array(grader.config?.required).includes(asset.name));
  return graders.some(grader => grader.type === 'tool-calls' && array(grader.config?.required).some(rule => {
    if (!rule || typeof rule !== 'object') return false;
    if (asset.kind === 'agent') return matches(rule.name, 'task') && matches(rule.args?.agent_type, asset.name);
    return matches(rule.name, asset.name) && typeof rule.result === 'string' && rule.result.length > 0;
  }));
}

export async function checkCoverage(assets, specs) {
  const ids = new Set(assets.map(asset => asset.id));
  const positive = new Set();
  const negative = new Set();
  const pr = new Set();
  for (const { path, spec } of specs) {
    if (!Array.isArray(spec?.stimuli) || !spec.stimuli.length) throw new Error(`${path}: empty stimuli`);
    for (const stimulus of spec.stimuli) {
      const tagged = array(stimulus.tags?.assets);
      if (!tagged.length) throw new Error(`${path}/${stimulus.name}: missing assets tag`);
      for (const id of tagged) {
        if (!ids.has(id)) throw new Error(`${path}: unknown asset ${id}`);
        const asset = assets.find(candidate => candidate.id === id);
        const graders = stimulus.graders ?? [];
        const environment = {
          skills: [...(spec.agent_environment?.skills ?? []), ...(stimulus.agent_environment?.skills ?? [])],
          files: [...(spec.agent_environment?.files ?? []), ...(stimulus.agent_environment?.files ?? [])],
          mcpServers: { ...spec.agent_environment?.mcpServers, ...stimulus.agent_environment?.mcpServers }
        };
        if (asset.kind === 'skill') {
          const paths = await Promise.all(environment.skills.map(skill => realpath(resolve(dirname(path), skill))));
          if (!paths.includes(await realpath(asset.path))) throw new Error(`${path}: ${id} isn't loaded into the eval`);
        } else if (asset.kind === 'agent') {
          const paths = await Promise.all(environment.files.map(file => realpath(resolve(dirname(path), file.src))));
          if (!paths.includes(await realpath(asset.path))) throw new Error(`${path}: ${id} agent profile isn't staged`);
        } else if (!environment.mcpServers[asset.serverName]) {
          throw new Error(`${path}: ${id} MCP server isn't configured`);
        }
        const outcome = asset.kind === 'mcp' || graders.some(grader =>
          /^(program|file-.+|output-.+|prompt|panel)$/.test(grader.type));
        if (stimulus.tags?.control === 'negative' && outcome) negative.add(id);
        if (invoked(asset, graders) && outcome) {
          positive.add(id);
          if (array(stimulus.tags?.suite).includes('pr')) pr.add(id);
        }
      }
    }
  }
  for (const id of ids) {
    if (!positive.has(id)) throw new Error(`${id}: missing invocation plus outcome coverage`);
    if (!pr.has(id)) throw new Error(`${id}: missing behavioral PR smoke coverage`);
    if (!negative.has(id)) throw new Error(`${id}: missing negative control`);
  }
}
