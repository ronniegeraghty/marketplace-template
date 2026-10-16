# Developing this marketplace

Plugins group related customizations by workflow, not by asset type. All catalog sources must stay inside this repository. Do not add external plugins or services.

- Use the Agent Plugins 1.0 root `plugin.json`, `skills/`, and `mcp.json` conventions. Copilot agents live under `com.github.copilot/agents/`.
- Keep each plugin independently installable. Never depend on the development checkout's `node_modules` at runtime.
- Keep evals outside plugins, grouped by workflow under `evals/`. Add behavioral coverage whenever adding or changing a skill, agent, or MCP tool. Do not replace real tool/agent invocation assertions with output keywords.
- Never stage answer keys or eval specifications into the agent's workspace. Use only synthetic fixtures and disposable directories, not git worktrees.
- Never copy private organizational material, credentials, or internal links into the examples.
- Run `npm ci`, `npm run build`, then `npm run verify`. Build regenerates the shipped MCP runtime and license notices; include those generated files with source changes.
- Run `npm run eval:pr` or `npm run eval` for real behavioral evaluations. They spend inference credits. Static checks don't establish behavioral quality.
- Valid behavioral failures are reported by default; tooling/configuration/grader errors must fail. Never hide failures with blanket catches or `continue-on-error`.
- Do not commit, push, change visibility, or modify GitHub permissions without explicit authorization.
