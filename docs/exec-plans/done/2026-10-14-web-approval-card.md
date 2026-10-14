# Web approval card

Visual target: reference image 2, white rounded card with a muted tool heading, a concise approval title, monospace command below it, expandable content and right-aligned pill actions.

| Step | Tool | Expectation | Rollback |
| --- | --- | --- | --- |
| Project the captured tool arguments with approvals | Edit broker/types/OpenAPI; targeted node tests | Full commands survive SSE and reload; no parsing clipped logs | Revert only this turn's edits |
| Render title and command/file preview in a white card | Edit conversation component/styles/i18n | No raw Call/undefined/batch logs; expandable long commands; only deny and allow-for-session buttons, per user feedback | Restore only edited approval UI blocks |
| Verify real approval decisions and visuals | Local deterministic provider, scratch file, browser e2e, npm run check | Allow writes, deny does not; screenshots match reference layout | Fix failures before handoff |
| Record result | QA record, move plan to done, concise memory update | Evidence and remaining Desktop-host limit recorded | Revert only these records |

No publishing, dependency changes or commits. Keep the working preview running and update its browser entry.

## Outcome

- White approval card now renders a tool heading, localized title and complete captured command/file arguments. Long content has a three-line preview with expand/collapse.
- Only Deny and Allow for Session are shown, per the user's follow-up; the existing verdict API remains available to hosts.
- Broker snapshots/SSE include `input` and a specific `reason`. Session grants match the canonical tool name across differing call IDs, while danger/incomplete-analysis prompts still ask per call.
- Tests: required `npm run check` passed; Web units 55/55; browser e2e 17/17. Approved a real local command to write a scratch file; verified denied commands do not run. No real model/provider calls.
- QA: final card 735 × 232 px, matching the normalized reference frame. Combined comparison and artifacts recorded in root `design-qa.md`.
- Existing preview at 31893 was updated using its original scratch directory and cookie secret; verified the user's current browser tab after refresh. Preview remains running.
- No commits, dependency or lockfile changes. Desktop-specific host check unavailable in this public checkout; memory follow-up retained.
