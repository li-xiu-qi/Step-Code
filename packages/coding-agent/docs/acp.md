# ACP mode

`step --mode acp` runs StepCode as an [Agent Client Protocol](https://agentclientprotocol.com/) v1 agent over stdio. The wire format is newline-delimited JSON-RPC 2.0, the same framing family as RPC mode, but the method names and payloads follow ACP.

Use this mode when an ACP client (an editor, desktop shell, or another agent host) needs to drive StepCode directly.

## Starting

```bash
step --mode acp
```

The process speaks ACP on stdin/stdout. Diagnostics and extension notices go to stderr, so stdout stays a clean JSON-RPC channel. `@file` arguments are rejected in ACP mode, just like RPC mode.

## Baseline methods

| Method | Direction | Notes |
|--------|-----------|-------|
| `initialize` | client → agent | Negotiates protocol version and agent capabilities. |
| `session/new` | client → agent | Creates a session. The `cwd` must match the agent working directory. |
| `session/load` | client → agent | Loads an existing StepCode session by ACP `sessionId`, which is the StepCode session id. |
| `session/prompt` | client → agent | Sends one user turn. Supports text, images, and resource links. |
| `session/cancel` | client → agent | Notification that cancels the active turn. |
| `session/update` | agent → client | Streaming notification for message chunks, thought chunks, and tool calls. |
| `session/request_permission` | agent → client | Tool approval request. The baseline offers allow-once and reject-once. |

`session/prompt` responds only after the turn finishes, with `stopReason` set to `end_turn` or `cancelled`.

## Session identity

`session/new` and `session/load` return the StepCode session id as the ACP `sessionId`. A later `session/load` can restore that id after a client restart. Loading a session whose recorded `cwd` does not match the request `cwd` is rejected.

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
- client-provided MCP servers and `additionalDirectories`

Those need separate product decisions and are tracked as follow-up work.

## Relationship to RPC mode

ACP mode reuses the same `AgentSessionRuntimeHost` as RPC mode. Session persistence, extensions, compaction, tool execution, and provider behavior are shared. Only the protocol surface is different. RPC mode remains the lower-level JSONL channel for process integration.
