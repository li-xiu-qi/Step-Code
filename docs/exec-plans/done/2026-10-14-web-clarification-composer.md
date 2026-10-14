# Web clarification composer

Visual thesis: reproduce the reference's quiet white question card, rounded outline, numbered choices and compact footer at the screenshot's logical pixel density. Reuse the product's theme and icon system.
Content: question header and pagination, prompt, choices, editable final row, skip and next/send actions; card sits above the existing composer. No voice controls.
Interaction: choice hover reveals an arrow; answering advances immediately; completing all answers submits once, with IME-safe Enter for custom text. Navigation preserves drafts and answers.

| Step | Tool | Expectation | Rollback |
| --- | --- | --- | --- |
| Add optional structured clarification UI capability to the coding tool and Web broker | Edit coding-agent and Web host | Existing clarify_user waits on the browser; validated answers resume the same tool call; abort/reload handled | Revert only this session's edits |
| Add HTTP/SSE/snapshot projection and composer card | Edit Web client and API schema | Pagination, option/custom/skip/cancel, auto-submit, retries and session isolation work | Revert only this session's edits |
| Verify behavior and screenshot fidelity | Targeted node tests, browser interaction, npm run check | Tests/check pass; compare supplied images with rendered card; record QA | Fix failures before delivery |
| Record outcome | Move plan to done; update Codex memory | Finished scope and remaining verification limits are recorded | Restore only these records |

No publishing, migration, dependency changes or commits are planned.

## Outcome

- Added optional `ExtensionUIContext.clarify`, bracketed by the existing custom UI prompt lifecycle. `clarify_user` now uses the Web capability in RPC mode, retains its native TUI path, and remains subject to explicit permission overrides.
- Added a cancellable, session-scoped Web broker, validated response route, SSE required/resolved events and snapshot restoration. The same pending tool receives canonical option values or freeform/skip results.
- Added the paginated card above the composer, with draft retention, custom Enter/IME handling, automatic final submission, double-click protection and retry after failure.
- Matched the supplied 2x references at 735 CSS px: final card 735 × 241 px; corrected the first 274 px layout and 14 px typography to the reference's 241 px / 13 px layout. Visual evidence and expected deviations are in root `design-qa.md`.
- Verified: `npm run check` passed (52 Web unit tests, type checks, architecture guards and runtime/browser smoke); Web e2e 15/15; targeted coding-agent permission/UI tests 49/49. A local deterministic model called the real clarification tool and resumed to write answers to a scratch file. No paid provider calls or real workspace edits were used in verification.
- Desktop host verification unavailable: this worktree has no `apps/desktop`. Shared React client was checked in the in-app browser, light/dark and a 390 px viewport.
- No commits created; lockfile and dependency metadata unchanged. npm prints two existing warnings for pnpm-specific `.npmrc` keys; all repository check stages exit successfully without code diagnostics.
