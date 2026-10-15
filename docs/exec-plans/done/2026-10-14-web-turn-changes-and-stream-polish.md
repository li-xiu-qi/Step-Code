# Web: per-turn file changes, diff panel, stream polish

## Goals

1. Tighter spacing between stream rows; message text 14px / weight 500.
2. Streaming text reveals smoothly and fades in, instead of jumping in bursts.
3. Stream only follows the bottom when the reader is already there (scrolling up while
   the model writes no longer snaps back).
4. Archive toggle shows a close icon ("关闭") while the archive list is open.
5. After every finished turn, a "已编辑 N 个文件 +a -d" card lists the files that turn
   changed (collapsible past 3). Clicking a file opens the right panel in a changes view
   (turn picker, file rows, inline diff). "撤销" reverts the turn's file changes.

## Steps

| Step | Tool | Expectation | Rollback |
|---|---|---|---|
| Host: capture a `write` target's previous content on `tool_call`, attach `details.patch` on `tool_result` (edit already has `details.patch`) | edit `apps/web/src/runtime.ts`, new `src/turn-changes.ts` | toolResult entries of write/edit carry a unified patch, persisted in the session file | revert the files |
| Host: `POST /api/v1/sessions/{id}/turns/{turnId}/revert` reverse-applies the turn's patches (all or nothing), records reverted turns in web metadata, `revertedTurns` in snapshot | `server.ts`, `runtime.ts`, `openapi.yaml`, unit test | test passes; mismatching file -> 409, nothing written | revert |
| Client: patch parsing + turn grouping (`lib/turn-changes.ts`), card in conversation, changes view in files preview panel | client edits | card per finished turn; panel shows diff | revert |
| Client: spacing, font, fade/smooth reveal, scroll stickiness, archive close icon | client edits | visual check in a browser | revert |
| Docs: `docs/stepcode-web.md` section on turn changes | edit | — | — |
| Verify: `pnpm run check`, web unit test, e2e, manual turn in a scratch workspace | commands | all pass | — |

Limits: files changed through `bash` are not tracked (only `edit` / `write`).
