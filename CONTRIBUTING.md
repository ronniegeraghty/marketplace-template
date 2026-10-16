# Authoring and evaluating a workflow bundle

Put assets together because they support the same task. A plugin can contain a
skill and agent, a skill and MCP server, or only the components it needs.

## Add or change an asset

1. Choose an existing workflow bundle or add `plugins/<workflow>/plugin.json`
   with the canonical Agent Plugins 1.0 schema, name, version, and MIT license.
   Add a repository-relative source entry to `.github/plugin/marketplace.json`.
   Keep catalog and manifest names/versions consistent.
2. Put skills in `skills/<name>/SKILL.md`, with a matching frontmatter name and
   specific description. Put Copilot agent profiles in
   `com.github.copilot/agents/<name>.agent.md`.
3. Put portable MCP configuration in the plugin's `mcp.json`. Use local stdio
   for this template. Package executable code and dependencies inside the plugin;
   use `${PLUGIN_ROOT}` for arguments and working directories. Don't use a
   developer's absolute path or depend on root `node_modules`.
4. Add or update `eval.yaml` under `evals/<workflow>/`. The specs load actual
   skills, stage the actual agent file, and configure actual MCP processes.
   Keep fixtures synthetic and grader-only inputs hidden from the agent.
5. Run `npm run build`, `npm run verify`, then the relevant real behavioral
   evals. Include generated artifacts and licenses with your source change.

## Coverage contract

`npm run check` discovers the catalog, local skill/agent files, and the local MCP
server's real tool list. Every in-repo asset needs invocation plus outcome assertions,
a behavioral PR smoke case, and a negative control. A tag alone is not coverage.

Use these `stimuli[].tags.assets` identity forms:

- `skill:<plugin>/<skill-name>`
- `agent:<plugin>/<agent-name>`
- `mcp:<plugin>/<server-name>/<tool-name>`

Set `tags.suite: pr` for the smoke case and `tags.control: negative` for a
negative control. Use globally unique stimulus names so saved outcomes map
unambiguously to the suite. `full` includes every eval spec.

Skill checks must load the skill and require actual `skill-invocation`. Agent
checks must stage the profile and require a `task` call with its `agent_type`,
then grade captured subagent behavior. MCP checks must use `tool-calls` with
the expected tool and actual result, not merely assert that the answer contains
a number the model could guess.

## Remote plugin references

Add remote plugins to the same catalog `plugins` array using a GitHub source
object, rather than copying their code into a local workflow bundle:

```json
{
  "name": "evals",
  "source": {
    "source": "github",
    "repo": "github/evals",
    "path": "packages/plugin"
  },
  "description": "GitHub Copilot Evals skills."
}
```

Confirm the install name and plugin directory against the upstream manifest.
Omit `path` only when the plugin is at the repository root. Paths must be
repository-relative without traversal or backslashes. Optional `ref` and
full-commit `sha` fields can select an upstream revision; without either, the
client uses the repository's default branch. Don't duplicate an upstream version
in the catalog unless you also maintain that metadata.

Document private-repository access and any separate runtime setup. Remote
references receive metadata validation only; they aren't fetched, installed, or
behaviorally evaluated by this repository's checks. Local installation tests use
a local-only catalog fixture so fork CI needs no upstream access. The local
asset coverage requirements remain unchanged.

## Graders and fixtures

Prefer deterministic graders. Include a wrong answer or clean input that would
expose a broken grader. Keep custom grader output compatible with Vally's
`GraderResult` schema. A grader startup/parsing error is not a valid negative
behavioral verdict.

The authoring grader is bundled from `evals/graders/src/authoring.mjs` and staged
only for grading. Its native tests exercise the distributed bundle, including
invalid output controls. It runs the pinned Vally static validator for generated
files; it doesn't launch another model.

Use the repository launcher for evals and re-grading. It supplies
`MARKETPLACE_VALLY_CLI` for that validator and an absolute `JSON_MCP_SERVER` Vally
parameter for the stateless MCP executable. Don't assume that an MCP process
starts in the trial workspace or that a direct CI `node` invocation has npm's
binary directory on `PATH`. A grader infrastructure exception must return
`status: error`, not an ordinary failed behavioral verdict.

Inspect failed trajectories before changing assertions. Don't loosen a check
simply to get green results, and don't replace a failed custom-agent launch with
the default agent's answer. Use `npm run eval:grade -- --help` to re-grade saved runs.

## CI and authentication

Follow the [current Vally CI guide](https://microsoft.github.io/vally/get-started/add-to-ci/).
Use the built-in short-lived GitHub token where supported. Never commit a token,
read an unrelated credential file, or expose model credentials to fork code.
The live workflow uses same-repository PRs, default-branch pushes, and manual
dispatch. It reports valid failed verdicts while failing operational errors.

Keep all asset, fixture, grader, dependency, and workflow paths in the live
workflow's change filters. Keep the deterministic check available for every PR.
When upgrading Vally or Copilot, verify real custom-agent delegation and MCP
behavior, not only schema validity. Update the pins and lockfile together.

## Releasing your marketplace

Bump changed plugin versions and their catalog entries together. Rebuild the MCP
and grader bundles, check generated-file freshness, and inspect all third-party
license notices. Verify installation from a clean copy using temporary client
configuration. Publishing the repository doesn't assign plugins to a Team or
change organization policy.
