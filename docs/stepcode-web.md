# StepCode Web Host

StepCode Web is a loopback-only Node Host plus a browser projection. It uses the
official StepCode composition boundary from the current `github-opensource`
source tree:

- `AgentSessionRuntime` owns the agent lifecycle.
- `AgentSession` owns the active session and event stream.
- `StepSessionManager` wraps Pi's current JSONL v3 `SessionManager`.
- `packages/agent-core`'s JSONL v4 `JsonlSessionRepo` is not used by Step CLI or
  this Web Host.

The Web Host does not parse, repair, migrate, or write session JSONL directly.
It projects session snapshots and agent events over HTTP/SSE and sends user
actions back through the runtime. The browser never receives credentials.

Authentication is a one-time launch token exchanged for a signed, HttpOnly,
SameSite cookie. API requests require the cookie and a local Origin. The
server binds to `127.0.0.1` by default. Logging out expires the browser cookie;
re-entry requires a fresh terminal launch link.

StepCode Web has no login of its own. Signing in is a terminal action —
`step login` writes `~/.stepcode/auth.json` — and the Host reuses that credential
exactly as the CLI does:

- It calls `syncStepLoginProfileEndpoint` before building the ModelRuntime, so the
  credential is sent to the region its stored profile names. The CLI does the
  same before every session; without it a `step_plan` credential goes to the
  default endpoint and discovery fails.
- It reads the persisted `defaultProvider` / `defaultModel` from `config.toml`
  (`readGlobalStepDefaults`) and passes them as the session defaults, which is
  what the CLI injects into argv through `withStepDefaults`. The result is that
  the Web UI lists the same models and starts on the same model as the CLI.
- It refreshes the model catalog *before* a session resolves its model. The Step
  catalog is discovered over the network and ships no built-in baseline, so an
  unrefreshed runtime offers zero models and the session would be left on
  agent-core's `unknown` placeholder, where sending fails with "No API key found
  for the selected model" — an error that names no provider.
- If resolution still yields no model, the session adopts the first model the
  runtime lists rather than staying on the placeholder.

`GET /api/v1/login` (and the `login` field of `/api/v1/bootstrap`) reports where
the credential comes from: `environment` or `auth.json`, with the provider,
login profile, validity, and the `step login` command that changes it. The
credential itself is never part of the response, and the settings dialog shows
this section read-only — there is no key field, because a field here could not
sign anything in.

Presence and reachability are reported separately: `getStepLoginStatus` treats an
unreachable provider as "not logged in", but the credential is still on disk and
the next request may succeed, so `configured` reflects the stored credential and
`validity` reports what the provider said (`valid`, `invalid`, `unavailable`).

The approval path is an adapter: Step extensions call
`ExtensionUIContext.confirm`, the Web Host's approval broker emits an SSE
request, and the browser returns `approve`, `approve_for_session`, or `deny`.
Missing or cancelled approvals fail closed.

Approval snapshots and SSE requests include the full captured tool `input` and
the specific policy `reason`. The browser renders a neutral card with a localized
approval title and the complete command or file-change preview, instead of the
clipped Call/batch diagnostic message. Content initially shows three lines and
can expand; the full arguments remain available before a verdict. The card offers
only Deny and Allow for Session. Allow for Session is keyed by the canonical tool
name, so later calls with different call IDs reuse the grant; other tools still
ask. Specific danger or incomplete-analysis prompts still require a verdict per
call, even with a session grant. These presentation changes do not alter the permission policy or the
existing verdict endpoint.

Clarification uses the existing `clarify_user` tool and the optional structured
`ExtensionUIContext.clarify(questions, signal)` capability. The coding tool owns
normalization and tool-result text; the Web Host transports the complete question
set through `clarification_required` SSE and `pendingClarifications` in snapshots.
The extension runner brackets this capability with the existing `custom`
`ui_prompt_start` / `ui_prompt_end` lifecycle, so runtime consumers see the same
user-wait interval as a terminal dialog.
`POST /api/v1/sessions/{id}/clarifications/response` validates question order and
option indexes, derives canonical option values, and resumes the pending tool
call. It never sends the answer as a new user prompt. `clarification_resolved`
removes the card on every connected page. Abort, session replacement and shutdown
cancel pending calls. Browser reload restores pending questions while the Host is
alive; restarting the Host does not replay interrupted tools.

The composer shows a paginated question card above its input. Clicking a choice
or skipping saves that answer and advances. The last outstanding answer submits
the complete set automatically. Custom replies use Enter (Shift+Enter inserts a
newline; IME confirmation does not submit). Paging preserves selections and text
drafts. Navigating ahead never implicitly answers an earlier question. The close
button cancels the set; failed sends retain answers for retry. Voice input is not
part of this flow. The shared React client renders the same card in desktop hosts.
`clarify_user` is classified as a non-mutating tool, so Ask opens the questions
directly; explicit per-tool confirm/deny overrides still apply. Escape cancels
the waiting turn through the existing interrupt action.

Within one Web Host process, an in-memory per-session writer lease prevents two
Web session objects from appending to the same JSONL file. This is not a
cross-process lock. An older CLI that does not participate in a lease protocol
must be closed before the Web Host opens the same session.

Workspaces are folders the user registered through "Add workspace" (sidebar
button, or Alt+Cmd+O / Ctrl+Alt+O). The Host opens the operating system's
folder chooser when that dialog would appear on the machine in front of the
user: a loopback bind, no SSH session, and a desktop (on Linux also a display
and zenity or kdialog). A browser cannot do this itself — its directory pickers
return file contents, never a path — so the page asks the Host
(`POST /api/v1/workspaces/pick`) and the request stays pending while the dialog
is open. `?` reports the mode so the page knows which to offer. The helpers are
`osascript` on macOS, `powershell.exe` on Windows (PowerShell compiles a small
C# wrapper around the Vista `IFileOpenDialog` in folder mode, so no extra
dependency is needed and non-ASCII paths survive the pipe), and zenity with a
kdialog fallback on Linux. One dialog at a time; a second request is refused
with 409. When the mode is `browse`, or when the helper fails, the page falls
back to the in-folder browser, so the button is never dead.
`STEPCODE_WEB_DIRECTORY_PICKER=native|browse` overrides the detection. The registry is Web Host metadata in
`web-workspaces.json` beside the session metadata: it only decides which
folders the sidebar lists before they hold a conversation. Removing a workspace
unregisters it and never touches files or sessions; the control is offered only
while the workspace has no conversations, because a workspace with sessions is
listed through them regardless.

File browsing is keyed by folder, not by session, so an empty workspace can be
browsed. `GET /api/v1/workspace/{files,file,raw,search}` take a `cwd` and answer
403 unless it is the launch folder, a registered workspace, or the cwd of an
existing session. Inside a workspace every path is resolved with `realpath` and
refused (400) when it lands outside the root, which also covers symlinks that
point out of the workspace.

- `files` lists one directory level (directories first, at most 1000 entries,
  `truncated` when cut). The tree is lazy: the browser asks for a level only
  when its folder is expanded, and remembers which folders were open.
- `search` is a bounded breadth-first name search. It runs on the Host because
  the browser only holds the levels already opened. It does not descend into
  `.git`, `node_modules`, or symlinked directories.
- `file` classifies a file as `text` (up to 1 MB, returned as UTF-8), `image`,
  `binary` (NUL byte in the first 8 KB), or `too-large`; only `text` carries
  content. `raw` streams images, and nothing else, for the preview.

Clicking a file opens a preview panel on the right: one tab per file, line
numbers, wrap toggle, reload, copy, a rendered view for Markdown, and inline
images. Highlighting is a small regex tokenizer per language family (comments,
strings, numbers, a shared keyword list), not a grammar per language; files over
300 KB are shown uncoloured and only the first 10 000 lines are rendered. The
panel is closed by default and takes its width from the main column, so the
shell remains two-column when nothing is being previewed. Shift+Cmd+B toggles
it; Alt+Cmd+P opens the tree for the current workspace.

Two readouts are derived from the session timeline rather than stored: the task
banner at the top right of the main column (task and subagent progress, from the
`task_*` and `subagent` tool calls) and the token indicator left of the model
picker (input/output totals, summed from the usage each assistant turn reports).
Both stay out of the way when there is nothing to report — the banner hides until
the session has run a task or a subagent, and the token control hides until a
turn reports usage — so neither shows a placeholder figure.

Session archive flags are Web Host metadata in `web-sessions.json`; canonical
conversation history remains the StepCode v3 JSONL file. Deleting a session
closes the runtime, removes the metadata entry, and removes that session's
canonical JSONL file.

Run from the repository root:

```bash
pnpm run web
pnpm run web:build
pnpm run web:serve
```

`pnpm --filter @step-harness/web test:e2e` runs the browser suite: it starts the
Host on a free port with a temporary agent directory and drives headless Chrome
over the DevTools protocol (set `CHROME_PATH` if Chrome is not in a default
location; the suite is skipped when none is found). It needs no model
credentials. The system folder chooser cannot be clicked by a test, so the
suite puts a stand-in with the real helper's name first on the server's PATH
and answers from a file; the real spawn, argv and parsing are still covered.

The production build emits `apps/web/dist/server.js`, the browser assets, and
`apps/web/dist/openapi.yaml`.

The browser UI follows PRD v2.0 revision 281 §3 and uses Kimi Code Web as its
information-architecture baseline: a light two-column shell, cwd-grouped
conversations in the sidebar, a conversation stream, and a centered composer
control group. There is no main-area header, fixed right rail, or Goal HUD.

The first release connects sessions, message/tool streaming, approvals, status,
cwd file browsing, four permission presets, model selection, known-workspace
selection, interrupt, archive/restore, rename, and deletion. The project module
retains the original MVP's project/group views, in-memory categories, category
filter, file tree, and in-place new conversation. Workspace selection is
available only when composing a new conversation; adding a workspace is always
available from the sidebar.

The avatar opens a Kimi-style account menu with Step Plan upgrade navigation,
light/dark/system appearance, zh-CN/en-US language, a local settings dialog,
and logout. Appearance and language persist in browser local storage. Search is
a first-release modal that filters session titles, message text, and workspace
paths with keyboard navigation.
Sessions whose stored working directory no longer exists stay readable under
Recent instead of being exposed as a file-browsable project.

Workspace selection appears only while composing a new conversation. It first
offers recent folders and then an in-app folder browser. Existing conversations
do not show a workspace switcher.

Attachments, agent-mode selection, and cron management UI remain outside the
10/15 first release. Cron capabilities remain available through conversation
tools.
