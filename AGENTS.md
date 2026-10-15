# Development Rules

## Commit attribution

- Keep the Git author and committer as the human contributor's verified GitHub identity.
- AI tools may assist with implementation, but they must not be added as commit co-authors.
- Do not add `Co-authored-by` or `Co-Authored-By` trailers for Claude, Claude Code, Codex, ChatGPT, OpenAI, Anthropic, or another AI client.
- Do not mention the client used to create a change in the commit message solely for attribution.
- Before creating or amending a commit, inspect its metadata and remove any AI-client attribution trailer.

This policy applies to commit metadata. Documentation may mention AI products when that is relevant to the product or feature being documented.

## Architecture

`step-harness` is a pnpm monorepo. StepCode is assembled from layered packages
under `packages/` and `apps/`, built on the Pi runtime. Dependencies flow one
direction only: a lower layer must never import a higher one.

### Package layers

Foundation (no internal dependencies):

- `packages/telemetry` (`@step-harness/telemetry`) — vendor-neutral
  telemetry contracts and typed schema utilities.
- `packages/tui` (`@step-harness/pi-tui`) — terminal UI library with
  differential rendering. A standalone presentation toolkit; it must not import
  agent, session, or product code.
- `packages/contracts` (`@step-harness/contracts`) — host-to-agent contracts:
  in-process facade types and wire framing for the step-agent SDK. Pure
  contracts, no business behavior.
- `packages/config` (`@step-harness/config`) — product-neutral configuration
  format, loading, and one-time startup migrations.

Core runtime:

- `packages/providers` (`@step-harness/providers`, depends on `telemetry`) — unified LLM
  API: provider adapters, model discovery, and provider configuration. All
  provider- and model-specific code lives here.
- `packages/agent-core` (`@step-harness/agent-core`, depends on `providers`,
  `telemetry`) — the general-purpose agent: the agent loop (`agent-loop.ts`),
  the harness (context assembly and compaction under `harness/`), transport
  abstraction, session state, and attachments. Product-neutral — it knows
  nothing about coding tools or the TUI.

Product:

- `packages/coding-agent` (`@step-harness/coding-agent`, depends on
  `agent-core`, `config`, `providers`, `pi-tui`) — the coding agent library.
  Owns the read/bash/edit/write tools, session management and persistence wiring
  (`src/core/session-*`), extensions, interactive and one-shot modes, the
  built-in theme catalog (`src/modes/interactive/theme/`), and the StepCode
  integration (`src/step/`).
- `apps/cli` (`@step-harness/cli`, depends on `agent-core`, `coding-agent`,
  `config`, `providers`, `pi-tui`) — the top-level product entrypoint that
  assembles the CLI and compiles the standalone `step` binary.

### Ownership rules

- **Agent loop:** one implementation, in `packages/agent-core` (`agent-loop.ts`).
  `packages/coding-agent` composes the coding product on top of it; it must not
  fork or reimplement the loop.
- **Session authority:** the session model and its persistence contract belong
  to `packages/agent-core`; `packages/coding-agent` wires session management
  (`src/core/session-manager.ts`) for the CLI. Clients (`packages/contracts`, TUI)
  hold only projections, connection state, and local input state.
- **Provider / model contract:** provider adapters, model discovery, and model
  types live in `packages/providers`; in-process facade types and event shapes live in
  `packages/contracts`. Keep provider SDKs out of `agent-core`, the `coding-agent`
  runtime, and `tui`.
- **Tool contract:** tool schemas, registration, permission decisions, and
  execution belong to `packages/coding-agent`. Provider adapters do not
  implement tool orchestration.
- **TUI / themes:** rendering primitives live in `packages/tui`; the built-in
  theme catalog and theme resolution live in `packages/coding-agent`
  (`src/modes/interactive/theme/`). Components consume the active theme — they
  must not hardcode product colors or create a second theme registry.

### Boundary constraints

- Respect the layering: `telemetry` / `tui` / `contracts` / `config` import no
  other internal package; `providers` depends only on `telemetry`; `agent-core`
  depends only on `providers` and `telemetry`; only `coding-agent` and `apps/cli`
  may reach the product layer.
- Do not duplicate prompt, context, or message assembly in a client — those
  semantics belong to `packages/agent-core` (harness) and `packages/contracts`.
- Do not put durable session, transcript, or checkpoint state in `packages/tui`
  components.
- New external integrations go behind an adapter boundary — a provider in
  `packages/providers`, or a dedicated adapter package. Do not import a
  third-party SDK from generic runtime or TUI code.
- Validate host-to-agent event shapes at the `packages/contracts` boundary; a
  renderer must not depend on host internals.
- When a change affects agent-loop behavior, session semantics, tool
  boundaries, provider contracts, or theme contracts, update the matching
  document under `docs/` in the same change.

### Package-level rules

Some packages have their own `AGENTS.md`. Before planning or editing code under
one of these directories, read its `AGENTS.md` in full and follow it together
with this file:

- `apps/web/` — `apps/web/AGENTS.md`
- `apps/desktop/` — `apps/desktop/AGENTS.md`

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- Use concise, clear, simple language. Define unavoidable jargon before using it.
- Explain non-trivial designs and problems as: problem, concrete example or short trace, then solution. State why the solution is necessary and distinguish it from optional complexity.
- Prefer concrete behavior and small illustrations over abstract summaries, dense terminology, or unexplained lists of changes.
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/coding-agent/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` so they stay configurable.
- Never modify `packages/providers/src/models.generated.ts` directly; update `packages/providers/scripts/generate-models.ts` instead, then regenerate. Including the resulting `models.generated.ts` diff is always OK, even if regeneration includes unrelated upstream model metadata changes.

## Commands

- After code changes (not docs): `npm run check` (full output, no tail). Fix all errors, warnings, and infos before committing. Does not run tests.
- Never run `npm run build` or `npm test` unless requested by the user.
- Never run the full vitest suite directly: it includes e2e tests that activate when endpoint/auth env vars are present. For all non-e2e tests, run `./test.sh` from the repo root. Otherwise run specific tests from the package root:
  - Vitest: `pnpm exec vitest --run test/specific.test.ts` from the package root (vitest is not hoisted to the repo-root `node_modules`, so a repo-root path fails; `pnpm exec` resolves the package-local bin).
  - `packages/tui` (`node:test`): `node --test test/specific.test.ts`
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts` + the faux provider. No real provider APIs, keys, or paid tokens.
- When regressions tests for fixing a github issue, add a comment with the github issue number next to the test.
- For ad-hoc scripts, `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Dependency and Install Security

- Treat pnpm dep and lockfile changes as reviewed code. Direct external deps stay pinned to exact versions.
- When updating `undici`, you MUST read its changelog/release notes for the target version and evaluate whether any changes may affect functionality before applying the update.
- Hydrate/update locally with `pnpm install --ignore-scripts`; clean/CI-style with `pnpm install --frozen-lockfile --ignore-scripts`. Don't run lifecycle scripts unless the user asks.
- If dep metadata changes, refresh `pnpm-lock.yaml` with `pnpm install --lockfile-only --ignore-scripts`.
- Pre-commit blocks lockfile commits unless `STEP_ALLOW_LOCKFILE_CHANGE=1`. Don't bypass unless the user wants the lockfile change committed.

## Git

Create all new work branches from `github-opensource`. Target only
`github-opensource` when opening or merging change requests.

Multiple StepCode sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- `packages/providers/src/models.generated.ts` may always be included alongside your files.
- Message format: `{feat,fix,docs}[(ai,tui,agent,coding-agent)]: <commit message> (optionally multiple lines)`. Message is informative and concise.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

See `CONTRIBUTING.md` for the contributor gate (auto-close workflows, `lgtm`/`lgtmi`, quality bar).

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When opening a merge request (MR):

- Title uses the same `{feat,fix,docs}[(scope)]: <summary>` convention as commits.
- Write the description in the repository house style: Chinese, technical, concise, with `##` sections in this order — `## 背景` (the problem; use `## 背景与判据` when the fix is selective and you must state the criterion for what to fix vs leave), `## 实现` / `## 修复` (grouped; numbered **bold** sub-headers, affected files in backticks, a "修复前:" contrast line where it clarifies), `## 验证` (tests added, pass counts, `npm run check` status, exec-plan landed), and an optional `## 边界` (what this version intentionally does not do). End AI-authored descriptions with the AI-generated attribution line.
- Write the body to a temp file and pass it with `glab mr create --description "$(cat <file>)"` (or `glab mr update <id> --description ...`); never a fragile inline multi-line string.

When creating issues:

- Add `pkg:*` labels for affected packages (`pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:tui`); use all that apply.

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt.

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the message so merging auto-closes the issue. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.

## Testing Step Interactive Mode with tmux

`./step-test.sh` runs the CLI from source, so it reflects the working tree
without a build (`--no-env` additionally strips provider credentials). Use the
installed `step` instead when you need to verify a built artifact.

Run the TUI in a controlled terminal (from the repo root):

```bash
tmux new-session -d -s step-test -x 120 -y 32
tmux send-keys -t step-test "./step-test.sh" Enter
sleep 3 && tmux capture-pane -t step-test -p     # capture after startup
tmux send-keys -t step-test "your prompt here" Enter
tmux send-keys -t step-test Escape               # special keys (also C-o for ctrl+o, etc.)
tmux kill-session -t step-test
```

A first run in a new directory asks whether the folder is trusted; answer it
before sending a prompt. Widths below ~100 columns truncate tool rows, so prefer
a wide session when checking layout.

## Releasing

**Step binary versioning**: Step releases use the product tag `vMAJOR.MINOR.PATCH`. The package versions may remain independent because packages are not published by this project.

1. **Local binary smoke test**: build the standalone Step bundle and smoke test the current-platform binary outside the repo:

   ```bash
   node infra/release/release-bundle.mjs --dry-run --version v0.1.0
   ./scripts/build-binaries.sh --product step --offline-model-data --platform linux-x64 --out /tmp/stepcode-release
   /tmp/stepcode-release/step --help
   /tmp/stepcode-release/step --version
   ```

   Verify the binary starts, reports the tag-derived version, loads native TUI resources, and completes a smoke prompt with the intended Step provider. Failures are release blockers unless the user explicitly accepts the risk.

2. **Public-source boundary**: the public repository only builds local artifacts. Internal tagging, binary publication, object-store upload, and release announcement jobs are intentionally kept outside this source tree.

3. **If an internal binary publication fails**: inspect the private release pipeline and rerun that job after fixing the issue. Do not recreate an existing tag.

## Execution Protocol

For any non-trivial change — a new subsystem, a multi-file refactor, or risky / hard-to-reverse work — plan before you edit:

1. First search `docs/exec-plans/active/` for a related plan and read it.
2. Before writing code or running side-effecting commands, write a short Markdown exec-plan to `docs/exec-plans/active/<YYYY-MM-DD>-<kebab-name>.md`. The filename must start with the plan creation date in ISO format (`YYYY-MM-DD`), followed by a lowercase kebab-case name; for example, `2026-04-01-stepcode-context-pipeline-and-memory.md`. Do not create undated exec-plan filenames. Cover: **Step** (what you will do), **Tool** (command or edit), **Expectation** (the result that means it worked), **Rollback** (how to undo if it fails).
3. For operations with side effects (deleting, publishing, releasing, migrating), request explicit confirmation at the end of the plan before proceeding.
4. Prefer the scripts under `scripts/` over ad-hoc command lines.

Exec-plans are execution records, not user-facing docs: keep them in `docs/exec-plans/active/` while in progress and move them to `docs/exec-plans/done/` once the work is complete (landed, or finished and verified). They are not part of any published docs navigation. When a change alters runtime behavior, tool boundaries, or a cross-process contract, update the matching doc in the same change rather than leaving the plan as the only record.

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.

## Commit attribution

- Keep the Git author and committer as the human contributor's verified GitHub identity.
- AI tools may assist with implementation, but they must not be added as commit co-authors.
- Do not add `Co-authored-by` or `Co-Authored-By` trailers for Claude, Claude Code, Codex, ChatGPT, OpenAI, Anthropic, or another AI client.
- Do not mention the client used to create a change in the commit message solely for attribution.
- Before creating or amending a commit, inspect its metadata and remove any AI-client attribution trailer.

This policy applies to commit metadata. Documentation may mention AI products when that is relevant to the product or feature being documented.

## 1. Scope and reading order

This file defines repository-wide rules for Step-Code. Before changing a directory, also read the `AGENTS.md` files in that directory and its ancestors. Local rules add module constraints; they cannot override this file's commit attribution policy, dependency direction, or public-source boundary.

- `CLAUDE.md` continues to reference this file; do not maintain a second set of repository rules.
- Organize architecture guidance around layers, responsibilities, and ownership. Verify paths, dependencies, commands, and defaults against current source, `package.json`, check scripts, and the relevant documentation.
- Check implementation status before borrowing designs from other repositories. Do not copy obsolete paths, unimplemented plans, or private branch and release procedures.

## 2. Project structure and dependency layers

The current source layout is:

```text
apps/
  cli/                         Process entry points and interactive host
    src/args/                  Arguments and mode selection
    src/bootstrap/             Startup composition
    src/commands/              Top-level commands
    src/modes/                 Mode routing
    src/bun/                   Standalone binary entry
    src/ui/                    UI host, runtime, and views
packages/
  agent-core/                  Generic Agent runtime
    src/harness/               Sessions, context, compaction, and generic tools
    src/search/                Generic search
  coding-agent/                Coding product and SDK
    src/core/                  Product session mechanisms, tools, and extensions
    src/features/              Plan, task, subagent, workflow, goal, and cron
    src/step/                  Step configuration, permissions, MCP, and integrations
    src/modes/                 Non-interactive execution
    src/server/                Host service adapters
    src/theme/                 Product themes
    src/render/                Rendering helpers
    src/components/            Reusable product components
    docs/                      Package APIs and usage
    examples/                  SDK and extension examples
    test/                      Product and session regressions
  config/                      Product-neutral startup migrations
  contracts/                   Independent host interfaces and wire frames
  providers/                   Model access, adapters, catalogs, and credentials
  telemetry/                   Telemetry contracts and reference implementations
  tui/                         Terminal input, layout, and rendering
docs/                          Repository-wide guides and runtime contracts
scripts/                       Checks, generators, builds, and development tools
infra/release/                 Local packaging and installer templates
plugins/                       Built-in marketplace and plugin declarations
.github/                       Public CI workflows and contribution templates
.husky/                        Git hook definitions
```

Package manifests and `scripts/workspace-registry.json` define workspace membership; build outputs and installed dependencies are not source modules. Read the [development and collaboration guide](docs/development.md) for implementation practices and [testing policy](docs/testing.md) to select validation.

Dependencies flow from product entry points toward foundational capabilities. Foundational packages must not depend on products or applications. The table defines allowed internal dependencies, not a requirement to depend on every listed package.

| Layer | Module and local rules | Responsibility | Allowed internal dependencies |
| --- | --- | --- | --- |
| Foundation | [telemetry](packages/telemetry/AGENTS.md) | Telemetry contracts, typed schemas, no-op and in-memory reference implementations | None |
| Foundation | [tui](packages/tui/AGENTS.md) | Terminal input, layout, differential rendering, and generic components | None |
| Foundation | [contracts](packages/contracts/AGENTS.md) | In-process host/Agent interfaces, wire events, and framing | None; runtime dependencies must remain empty |
| Foundation | [config](packages/config/AGENTS.md) | Product-neutral configuration migrations | None |
| Model runtime | [providers](packages/providers/AGENTS.md) | Providers, API dialects, model catalogs, credentials, and vendor adapters | telemetry |
| Agent runtime | [agent-core](packages/agent-core/AGENTS.md) | The single Agent Loop, generic harness, session and context semantics | providers, telemetry |
| Coding product | [coding-agent](packages/coding-agent/AGENTS.md) | Coding sessions, tool policies, extensions, orchestration, Step integrations, and themes | agent-core, providers, config, tui |
| Application host | [apps/cli](apps/cli/AGENTS.md) | argv, startup composition, mode routing, process lifecycle, and interactive UI | coding-agent, agent-core, providers, config, tui |

- Register new workspaces in `pnpm-workspace.yaml`, root `package.json`, and `scripts/workspace-registry.json`. Use the `@step-harness/*` scope for new internal packages.
- Use public package entry points for cross-package calls. Do not depend on another package's `dist/` layout or bypass boundaries with deep source imports.
- `packages/**` must not import `apps/**`. `packages/tui` must not depend on Agent, provider, session, or product code.
- Put new vendor SDKs behind adapters in `packages/providers`. Coding-product integrations such as MCP and plugins belong in `packages/coding-agent`, not the generic Agent Loop or rendering library.

## 3. Ownership of core concepts

| Concept | Semantic owner | Product and host usage |
| --- | --- | --- |
| Agent Loop | `packages/agent-core/src/agent-loop.ts` | coding-agent composes it; TUI, print, JSON, RPC, and SDK reuse it. Do not create another loop. |
| Session / transcript | Generic session contracts in agent-core; coding-agent's `AgentSession` / `SessionManager` own coding-session execution and persistence | UI holds input, connection, selection, and presentation state; it must not become the authority for persistent sessions. |
| Context / compaction | Generic harness in agent-core; message conversion, skill retention, and recovery adapters in coding-agent | Presentation code must not assemble a second model context. Request projection must not rewrite the original transcript. |
| Provider / model | Registration, catalogs, dialects, and adapters in providers | Products select and configure models. Dispatch by API dialect, never by provider name or display metadata. |
| Tool / permission | Generic tool primitives in agent-core; coding tools, registration, permissions, and output retention in coding-agent | Clients present approval requests rather than duplicate permission decisions. Providers do not orchestrate tools. |
| Subagent / workflow / goal / cron / plan / task | `packages/coding-agent/src/features/` | Compose through extensions and the same session lifecycle. Do not infer state from UI text or model replies. |
| Configuration and resources | Neutral migrations in config; settings, trust, and resource resolution in coding-agent's core / step | CLI injects paths, defaults, and UI hooks. Step settings use `config.toml`; credentials, models, and sessions retain their own storage contracts. |
| Theme / TUI | Product themes in coding-agent's `src/theme/`; rendering primitives in tui; interactive composition in `apps/cli/src/ui/` | Components consume the active theme. Do not add another theme registry or rendering loop. |
| Host protocols | Independent in-process and wire contracts in contracts; concrete RPC / stdio protocols in existing mode entry points | Do not assume every mode already uses contracts. Adapt and validate new connections at host boundaries; keep concrete host objects out of contracts. |

## 4. Choosing directories and implementing changes

- Generic context, session, and tool primitives: `packages/agent-core/src/harness/`. Coding-product adapters: `packages/coding-agent/src/core/`.
- Built-in product features and orchestration: `packages/coding-agent/src/features/`. Extension loading, registration, and hooks: `packages/coding-agent/src/core/extensions/`.
- Step login, unified configuration, MCP, plugins, permissions, and feedback: `packages/coding-agent/src/step/`. Plugin manifests: `plugins/`.
- CLI commands and startup: `apps/cli/src/commands/`, `args/`, `bootstrap/`, and `modes/`. Product UI: `apps/cli/src/ui/`.
- Shell / bootstrap / modes enter UI only through `#ui` or `#ui/index`, never deep `#ui/...` imports. UI must not import the shell.
- UI dependencies flow host → runtime → view. Runtime receives host capabilities through its own `RuntimeContext`; view must not import runtime. If used, `ui/state/` is a leaf and must not depend on host, runtime, or view.
- Use existing actions and keybinding tables. Do not hardcode key matching in product logic.
- Provide complete TypeScript types for public interfaces. Prefer `unknown` with validation over unnecessary `any`; verify external APIs against installed dependency types.
- Relative TypeScript imports use `.ts` extensions and follow `check:ts-imports`. Source checked by the root configuration uses erasable syntax; do not add `enum`, parameter properties, or syntax requiring JavaScript emit.
- Do not hand-edit `packages/providers/src/models.generated.ts` or provider data snapshots. Change generator scripts or inputs, then run the corresponding generation commands.
- Preserve existing features and explicit user requirements. Do not delete functionality, weaken checks, or introduce unrelated refactors to make type or boundary checks pass.
- Keep functions at one abstraction level; introduce helpers only when they own a meaningful operation, policy, or reusable behavior.
- Validate external JSON, configuration, persisted data, and protocol inputs at their entry points. Narrow `unknown`; justify unavoidable `any` and type assertions rather than weaken checks or duplicate validation at every typed internal call.
- Comments and JSDoc explain non-obvious behavior, failure, cancellation, and resource ownership; do not restate code or record an implementation conversation.
- Handle failures at an explicit owner. Do not silently ignore invalid configuration, uncertain outcomes, or partially completed mutations. Best-effort catches must explain why ignoring the error is safe.
- Cancellation and teardown must settle owned work, release resources, and prevent late callbacks from publishing into replaced sessions; requesting an abort alone does not prove cleanup completed.

## 5. Development and validation

- Use Node.js `>=22.19.0` and the pnpm version in the root manifest. Install with `pnpm install --ignore-scripts`; reproduce the locked environment with `pnpm install --frozen-lockfile --ignore-scripts`.
- Pin direct external dependencies to exact versions. Update the lockfile with dependency changes; do not update dependencies for documentation tasks or bypass lockfile commit checks.
- Run source through root `pnpm step` or `./step-test.sh`. `./step-test.sh --no-env` removes listed provider environment credentials, but local user resources still require care.
- After code changes, run root `pnpm run check`, inspect the full output, and fix errors. It includes Biome autofixes, type checks, and boundary checks; it does not run tests.
- Select tests for changed behavior using the [testing policy](docs/testing.md). Run Vitest from the owning package with `pnpm exec vitest --run <test-path>`; tui uses `node --test test/<name>.test.ts`.
- Use `./test.sh` for repository tests and follow the pre-submission requirements in [CONTRIBUTING.md](CONTRIBUTING.md). It isolates user resources and credentials and builds offline if outputs are missing. Do not run a full Vitest suite that may activate real providers directly.
- Unit and regression tests use faux providers, fixtures, mocks, and temporary directories. They must not read real accounts or consume paid model requests.
- For documentation-only changes, verify relative links, directories, and commands and run `git diff --check`; follow the repository-wide pre-submission checks in `CONTRIBUTING.md`. Build only when a selected check needs artifacts; do not introduce real model calls for documentation validation.
- When changing Agent Loop, sessions, tool permissions, providers, themes, or cross-process contracts, update the relevant `docs/`, package documentation, and affected `AGENTS.md` files.

## 6. Task execution and Git collaboration

- Before editing, read affected files, local rules, and relevant documentation. For complex or high-risk work, explain steps, tools, acceptance criteria, and rollback. Continue reversible work already authorized by the user.
- For concurrent work, name module and file owners, agree shared interfaces first, and assign one integration owner. Coordinate edits to public types, exports, manifests, and the lockfile; hand off changed behavior, validation results, and remaining issues using the [collaboration workflow](docs/development.md#collaboration-workflow).
- Prefer existing tools in `scripts/`. Keep temporary validation scripts in temporary directories, outside product source.
- Do not commit or push unless requested. Stage only explicit paths belonging to the task; do not use `git add .` or `git add -A`.
- If the working directory contains another task's changes, use a separate worktree or touch only your files. Do not stash, clean, or revert other contributors' changes.
- Do not use `git reset --hard`, `git checkout .`, `git clean -fd`, skip hooks, or raw `--force`. Rewrite a published task branch only when explicitly requested; record its live remote OID, use an exact `--force-with-lease`, and abort on remote movement. If a Git operation conflicts with unrelated files, stop that operation and explain the conflict.
- Write commit subjects and bodies, PR/MR titles and descriptions, public issues, and review comments in English. Commit and PR/MR titles follow Conventional Commits; split commits by coherent responsibility, not to inflate the history.
- Commits, PR/MR descriptions, issues, and comments must not include AI-client attribution, bot co-authors, or generated-by footers. Keep author / committer as the current human contributor's Git identity.
- Report the changes, validation evidence, and anything still unverified. Keep delivery notes concise and specific.

## 7. Public source and support directories

- Public source includes code, public tests, local builds, and CI checks. Private telemetry exporters, internal endpoints, release credentials, protected-tag operations, and upload/publication workflows stay in a separate release environment.
- Do not copy internal execution records, private CI configuration, or infrastructure addresses into this repository. Follow the [public-source boundary](docs/open-source-status.md) and `check:public-boundary`.
- Documentation: follow [docs/AGENTS.md](docs/AGENTS.md).
- Check and build scripts: follow [scripts/AGENTS.md](scripts/AGENTS.md).
- Local release packaging and installer templates: follow [infra/release/AGENTS.md](infra/release/AGENTS.md).
- Built-in plugin manifests: follow [plugins/AGENTS.md](plugins/AGENTS.md).
