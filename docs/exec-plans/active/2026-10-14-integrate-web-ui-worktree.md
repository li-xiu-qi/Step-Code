# Integrate Web UI worktree

Target: `feat/stepcode-web-mvp-gh` at `/Users/jyxc-dz-0100626/Step-Code`. This worktree is detached at `e7f7f91`; the target has one newer commit (`b2e80f8`) for immediate thinking feedback.

| Step | Tool | Expectation | Rollback |
| --- | --- | --- | --- |
| Confirm target is clean and inspect its newer commit and Git attribution | Git status/show/config, GitHub identity inspection | Only this chat's files are staged; human author/committer; no AI trailers | Stop before commit if identity or ownership differs |
| Commit this session's completed changes | Explicit git add paths; git commit with normal hooks | Hooks/checks pass and the implementation is preserved as a commit | Keep worktree and commit available if integration fails |
| Integrate into the target branch | git merge commit in the clean primary checkout | Target contains both UI work and the newer thinking-feedback commit | Abort conflicts outside this session's files; retain source worktree |
| Validate combined tree | npm run check; Web browser and focused coding-agent tests | Combined implementation passes, no uncommitted or unresolved changes | Fix only owned files; do not delete source until verified |
| Stop this chat's preview and remove the source worktree | Owned exec-session stop; git worktree remove without force from primary checkout | Commit remains reachable from target; worktree disappears; no ignored checkout files needed | Recreate a checkout from the preserved commit if needed |
| Update persistent memory | Existing project/open-loop notes | Target, commits, verification and remaining real-model/Desktop limits recorded | Preserve prior memory entries |

The user explicitly authorized committing/integrating this worktree and deleting it in this turn. No remote push or PR is requested.
