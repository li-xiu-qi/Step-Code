# ACP mode

`step --mode acp` runs StepCode as an [Agent Client Protocol](https://agentclientprotocol.com/) agent over stdio. The wire format is newline-delimited JSON-RPC 2.0, the same framing family as RPC mode, but the method names and payloads follow ACP. The agent negotiates v1 or v2 at `initialize` and answers with the shape that version defines.

Use this mode when an ACP client (an editor, desktop shell, or another agent host) needs to drive StepCode directly.

## Starting

```bash
step --mode acp
```

The process speaks ACP on stdin/stdout. Diagnostics and extension notices go to stderr, so stdout stays a clean JSON-RPC channel. `@file` arguments are rejected in ACP mode, just like RPC mode.

## Protocol versions

`initialize` picks the version from the client's `protocolVersion`.

- v1 keeps the historical answer: `agentCapabilities`, `agentInfo`, `authMethods`, and `protocolVersion`.
- v2 requires client `info.name` and `info.version` and answers with the stable baseline: `info`, `capabilities.session.prompt.image`, and `authMethods`.

Method availability follows the negotiated version:

| Method | v1 | v2 | Notes |
|--------|----|----|-------|
| `session/new` | yes | yes | Creates a session. The `cwd` must match the agent working directory. |
| `session/load` | yes | no | Removed in v2; rejected with `method_not_found`. |
| `session/resume` | no | yes | Restores a stored session. Replays stored messages only when `replayFrom` is `{ type: "start" }`; any other `replayFrom` type is rejected. |
| `session/list` | no | yes | Lists stored sessions, optionally filtered by `cwd`. Cursor pagination is not supported. |
| `session/close` | no | yes | Cancels the active turn, clears pending permission requests, and answers `{}`. |
| `session/prompt` | yes | yes | Sends one user turn. Supports text, images, and resource links. |
| `session/cancel` | yes | yes | Notification that cancels the active turn. |
| `session/update` | yes | yes | Streaming notification for message chunks, thought chunks, tool calls, notices, and state. |
| `session/request_permission` | yes | yes | Tool approval request. The baseline offers allow-once and reject-once. |

Under v2, `session/prompt` answers as soon as the turn is accepted, with the `messageId` of the user message, and then streams `state_update` transitions: `running`, `requires_action` while a permission is pending, and `idle` with a `stopReason` or an `error`. Under v1 it answers only after the turn finishes, with `stopReason` set to `end_turn` or `cancelled`.

Under v2, tool progress arrives as `tool_call_update` with `pending`, `in_progress`, and a terminal status, and message chunks carry a stable `messageId` per assistant message so a client can group them. Tool input is sanitized before it leaves the process: keys containing token, secret, or password are replaced with `[redacted]`.

## Baseline methods

| Method | Direction | Notes |
|--------|-----------|-------|
| `initialize` | client → agent | Negotiates protocol version and agent capabilities. |
| `session/new` | client → agent | Creates a session. The `cwd` must match the agent working directory. |
| `session/load` | client → agent | v1 only. Loads an existing StepCode session by ACP `sessionId`, which is the StepCode session id. |
| `session/prompt` | client → agent | Sends one user turn. Supports text, images, and resource links. |
| `session/cancel` | client → agent | Notification that cancels the active turn. |
| `session/update` | agent → client | Streaming notification for message chunks, thought chunks, and tool calls. |
| `session/request_permission` | agent → client | Tool approval request. The baseline offers allow-once and reject-once. |

## Session identity

`session/new` and `session/load` return the StepCode session id as the ACP `sessionId`. A later `session/load` can restore that id after a client restart. Loading a session whose recorded `cwd` does not match the request `cwd` is rejected. Under v2, `session/resume` and `session/list` take the same id.

## Prompt content

The baseline accepts:

- `text`
- `image` with base64 `data` and `mimeType`
- `resource_link`, rendered into the prompt as `[[name]](uri)`

Embedded `resource` blocks are not advertised in `promptCapabilities.embeddedContext` and are rejected.

## Permissions

Tool approval uses ACP `session/request_permission`. The current mapping is intentionally small:

- `allow_once` approves the pending tool call.
- `reject_once` rejects it.
- A cancelled request rejects it.

ACP has no baseline free-form text input, so extension `input()` and `editor()` resolve to `undefined`. Extension `select()` is mapped to an allow/reject approval and returns the first option only when approved.

## Not in this baseline

The first ACP integration covers the issue's core loop: initialize, create or load a session, stream a turn, cancel it, and approve tools. These ACP surfaces are not implemented yet and return `method_not_found` or are not advertised:

- `terminal/*` client terminals
- session config options and `session/set_config_option`
- session modes and `session/set_mode`
- client-provided MCP servers: a non-empty `mcpServers` list is rejected with `invalidParams`, and HTTP/SSE MCP is not advertised
- `additionalDirectories`: a non-empty list is rejected with `invalidParams`

Those need separate product decisions and are tracked as follow-up work.

## Relationship to RPC mode

ACP mode reuses the same `AgentSessionRuntimeHost` as RPC mode. Session persistence, extensions, compaction, tool execution, and provider behavior are shared. Only the protocol surface is different. RPC mode remains the lower-level JSONL channel for process integration.
