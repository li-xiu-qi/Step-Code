# Web: slash menu (skills, MCP) and per-turn undo semantics

Worktree `.claude/worktrees/web-slash`, branch `feat/web-turn-changes-slash`, on top of the uncommitted
2026-10-14 turn-changes work.

| Step | Tool | Expectation | Rollback |
|---|---|---|---|
| Undo each turn independently: hunks may move, edge context may change (fuzz); structured 409 codes; tell the model through a `stepcode-web.turn-revert` custom message, which also marks the turn reverted | `apps/web/src/turn-changes.ts`, `runtime.ts`, `server.ts`, unit tests | undoing newest-first always works; an overlapping older turn is refused with the file named | revert files |
| Export MCP status with `error` and config-disabled servers | `packages/coding-agent/src/step/mcp.ts`, `index.ts`, mcp-startup test | vitest passes; `/mcp` in the TUI also lists disabled servers | revert |
| Host routes: `GET /sessions/{id}/skills`, `GET /workspace/skills`, `GET /mcp` | `server.ts`, `runtime.ts`, `skills.ts`, `openapi.yaml` | JSON lists | revert |
| Composer slash menu (fuzzy, keyboard), MCP status view, skill chip in the stream, skill-aware session titles | client | matches the reference screenshots | revert |
| Real scenarios in `/tmp/stepweb-mt`: three turns, undo order, model told, MCP tool call, skill load | browser | done, all passed | — |
