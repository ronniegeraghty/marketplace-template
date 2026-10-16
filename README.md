# Marketplace template

A GitHub template for teams publishing their own Copilot plugin marketplace.
The examples are organized by workflow, with behavioral evaluations for every
skill, custom agent, and MCP tool.

| Installable plugin | What it contains | Try it |
| --- | --- | --- |
| `customization-authoring` | A skill for authoring skills and their evals | "Create a skill and evals for summarizing a changelog." |
| `code-review` | An adversarial-review skill and read-only reviewer agent | "Use adversarial-review to review this diff without changing it." |
| `json-configuration` | A JSON usage skill and a self-contained local MCP server | 'Use json-configuration to validate {"port":8443} and look up /port.' |

Each plugin works independently. There are no external plugin entries,
hosted services, or external accounts required by the examples. Copilot itself
and live evals require model access.

## Create your team's marketplace

1. Select **Use this template** on GitHub and create a repository under your
   account or organization. This source repository is private while it is being
   developed; users need access to it to copy or install from it.
2. In `.github/plugin/marketplace.json`, replace the marketplace `name` and
   `owner.name`. In each `plugins/*/plugin.json`, replace `repository`. Update this
   README's installation examples and review the MIT copyright notice.
3. Keep catalog entries pointed at the local workflow directories. Add or remove
   a whole workflow bundle rather than grouping all agents or all skills together.
4. Run the development checks below, then commit and push your changes.
   Sharing this Git repository is publishing the marketplace; no registry service
   or organization-wide deployment is implied.

## Install an example

Requires a current Copilot CLI, Node.js 22.14 or newer for the local MCP server,
and access to the source repository:

```sh
copilot plugin marketplace add ronniegeraghty/marketplace-template
copilot plugin marketplace browse marketplace-template
copilot plugin install customization-authoring@marketplace-template
copilot plugin install code-review@marketplace-template
copilot plugin install json-configuration@marketplace-template
```

Choose only the plugins you need. After copying the template, use your own
`OWNER/REPO` and the `name` in your marketplace catalog.

Copilot CLI names the installed reviewer agent `code-review:code-reviewer`.
Select that identifier with `--agent` or the agent picker; the companion review
skill resolves the advertised identifier automatically. Workspace-staged agent
profiles in the eval fixtures use the unqualified `code-reviewer` name.

In VS Code, use **Chat: Install Plugin From Source** or configure the repository
as a marketplace in `chat.plugins.marketplaces`, then select a plugin. Enable
agent plugins if disabled. See the [VS Code plugin guide](https://code.visualstudio.com/docs/agent-customization/agent-plugins).

For local development, install a plugin directory, for example
`copilot plugin install ./plugins/json-configuration`. Reinstall after changes
when the client uses a cached copy. The committed MCP bundle is self-contained:
consumers don't run `npm install` inside an installed plugin.

For a local-directory marketplace, `plugin list` also lists disabled catalog
entries. Only the workflow you install is enabled. The JSON tools use finite
JavaScript numbers; overflowing values are rejected rather than silently
converted to null. Represent exact large integers or decimals as JSON strings.

## Develop and check the assets

Development uses the pinned dependencies in `package-lock.json`. CI uses Node
24.14.1; Node 22.14+ is the supported minimum.

```sh
npm ci
npm run build
npm run verify
```

- `build` regenerates the standalone MCP runtime, authoring grader, and licenses.
- `check` validates schemas, local catalog sources, asset identities, eval
  coverage, types, and generated-file freshness. It starts the local MCP server
  to discover its actual tool list; it doesn't contact a model.
- `test` runs deterministic unit, protocol, relocation, coverage, and reporting
  tests. It doesn't require model credentials.
- `eval:lint` performs strict Vally skill/spec validation without agent execution.

Commit the generated runtime, grader, license notices, and lockfile with source
changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for the authoring loop.

## Run real behavioral evals

Authenticate Copilot locally, or provide a token using the
[documented runtime setup](https://microsoft.github.io/vally/get-started/runtime-setup/).
Live runs consume inference credits; don't supply production data.

```sh
npm run eval:pr
npm run eval
npm run eval:report -- --suite full
```

`eval:pr` runs a real behavioral smoke set across the three bundles. `eval` runs
the full positive, negative, and boundary-case suite. Neither is a lint-only
substitute. The baseline model is `gpt-5.4-mini`; override it with, for example,
`npm run eval -- --model MODEL_ID`.

The small `scripts/eval.mjs` launcher still runs Vally's built-in `copilot-sdk`
executor. It selects the pinned full Copilot runtime through `COPILOT_CLI_PATH`.
The SDK's bundled standalone runtime could discover our custom agent but
rejected its execution with `custom_agent_prompt` unsupported. The full runtime
supports real delegation and captured subagent evidence; the evals require both.
The launcher also limits concurrency to two workers, disables automatic retries,
and requests JUnit output. Per-case timeouts live in the specs.

The launcher resolves the stateless MCP bundle to an absolute path using Vally's
`JSON_MCP_SERVER` parameter, so it doesn't depend on the runner's working
directory. It also supplies the authoring grader with the pinned validator's
absolute entry point rather than relying on npm having modified `PATH`.

Vally writes a timestamped directory under `vally-results/` with `results.jsonl`,
`eval-results.md`, JUnit, session logs, and trajectories. The authoring case also
preserves its generated files. Re-grade saved evidence with
`npm run eval:grade -- --help` to see Vally's grading options. This uses the same
pinned tools without paying for another agent run when only a grader changes.

The summary command checks completeness of the selected standard suite. To read
an older run, pass `--run-dir PATH` alongside `--suite pr` or `--suite full`.

### What passes mean

| Check | Evidence |
| --- | --- |
| Skill authoring | Actual activation, generated artifacts, meaningful task/non-trigger assertions, and strict validation of those artifacts |
| Code review | Actual named-agent delegation, findings from that subagent, seeded-bug and clean cases, and no workspace edits |
| JSON configuration | Actual local MCP calls and returned values/errors, including null versus missing values and pointer escaping |
| Packaging | Schema-valid manifests and a relocated server that runs without the developer checkout's dependencies |

These fixtures establish their stated contracts, not universal review accuracy
or the quality of every future generated skill. Eval specs and answer keys stay
outside installed plugins; grader-only files use `grading_environment`.

## CI: checks and behavioral results

`checks.yml` runs credential-free checks on Linux and Windows for every PR.
`evals.yml` runs the behavioral smoke suite on relevant same-repository PRs and
the full suite on relevant `main` pushes or manual dispatch.

The live job uses `GITHUB_TOKEN` with `copilot-requests: write`. For a personally
owned repository, inference is billed to the owner's Copilot seat. An
organization-owned copy needs **Allow use of Copilot CLI billed to the
organization** enabled. No long-lived PAT is required by default. See
[GitHub's authentication and billing guidance](https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/copilot-cli-in-github-actions)
and [Vally's CI guide](https://microsoft.github.io/vally/get-started/add-to-ci/).

- **Valid behavioral failures:** evals still run, scores/failures remain visible,
  and the CI check doesn't fail merely because a verdict misses its threshold.
- **Operational errors:** configuration, authentication, execution, grader
  errors, missing results, and unexpected skips fail the check.
  Runtime error events also fail it, even if the runner's outer record says
  `success`; a failed MCP startup isn't a behavioral score.
- **Fork PRs:** no credentialed live eval before merge. They receive deterministic
  checks; live evals run on `main` after merge. Never use `pull_request_target`
  to execute fork code with credentials.

Reports and trajectories are uploaded even on failure. There is no blanket
`continue-on-error`. To make valid behavioral failures fail CI too, add
`--require-pass` to the eval command and configure the required status check in
your repository. Review budget and permissions before enabling live workflows.

## Format and licensing

The template uses [Agent Plugins 1.0](https://agent-plugins.org/specification):
root `plugin.json`, portable `skills/` and `mcp.json`, and Copilot agents in
`com.github.copilot/agents/`. Evals are repository development assets, not a
nonstandard manifest field.

Original template content is [MIT licensed](LICENSE). Vendored Agent Plugins
schemas retain their Apache-2.0 license and attribution in `schemas/`.
Bundled dependencies retain their notices beside the generated files.

The structure and eval workflow were informed by the public
[VS Code team marketplace](https://github.com/microsoft/vscode-team-kit).
No private organizational skills or internal endpoints are included.
