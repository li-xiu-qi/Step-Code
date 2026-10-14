# StepCode Web visual QA

final result: passed

## Comparison target

- Scope: the clarification card above the existing StepCode composer. The surrounding composer keeps the existing product layout; voice controls are omitted as requested.
- Source 1: `/var/folders/99/g1vg4kd57_lcw86v4zxzycbw0000gp/T/codex-clipboard-789e3e9b-2c54-4a3a-ae4e-16511fe8db83.png` (1548 × 636 px).
- Source 2: `/var/folders/99/g1vg4kd57_lcw86v4zxzycbw0000gp/T/codex-clipboard-f760a3a7-9412-4a2b-8fd4-39e6f432d4a9.png` (1486 × 486 px).
- Reference cards were cropped and normalized from 2x to 1x: 735 × 242 px and 734 × 241 px. The half-pixel rounding and 1 px width difference are density/crop differences.
- Implementation: in-app browser, local scratch host `http://127.0.0.1:31893/?sb=0`, viewport 799 × 600 CSS px, 1x. Card measured 735 × 241 CSS px.
- States: question 1 of 3 (unanswered), question 3 of 3 (first option hovered), light theme, same question/option content as the references.
- Artifacts directory: `/Users/jyxc-dz-0100626/.codex/visualizations/2026/10/14/01a1399b-5be0-78c3-ba4f-219e68abfefd/`.
- Browser screenshots: `step-clarification-full-first.jpg`, `step-clarification-full-third.jpg`; card crops: `step-clarification-first.png`, `step-clarification-third.png`.
- Combined comparison inputs opened together: `step-clarification-compare-first.png`, `step-clarification-compare-third.png`. These show each normalized reference directly above its implementation.

## Findings and comparison history

1. Initial P2: implementation card was 274 CSS px high; question/option type was 14 px, visibly larger than the normalized reference. Corrected navigation height, heading gap, option height, footer gap and 13 px question/choice typography. Recaptured: 735 × 241 px, with matching heading width and row rhythm.
2. Initial P2: disabled navigation retained the primitive's hover background. Cleared its background in the disabled state. Header controls remain muted with no active hover block.
3. Final comparison: no actionable P0/P1/P2 differences in the requested card. Header, question, numbered rows, hover surface/arrow, custom reply row and footer align with the reference. The microphone is intentionally absent.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts / typography | Existing macOS system/PingFang stack; 13 px heading/choices, 600/550 weights; 14 px custom reply; matched wrapping at the reference width. |
| Spacing / layout | 16 px inset, 20 px card radius, 20 px numbered badges, 32 px option rows with 4 px gaps, 28 px pill controls, 8 px card-to-composer gap. Final normalized height 241 px. |
| Colors / tokens | White surface, faint outline, muted navigation and placeholder, soft hover surface, grey disabled action; mapped through existing tokens/color-mix. Also visually inspected the dark theme. |
| Assets | Standard sprite icons; question/pencil use Lucide/Feather source shapes with provenance documented. No raster assets occur in the reference; no generated assets were needed. |
| Copy / content | Same fixture questions and choices as the reference; page counter and next/send labels match. Product-owned copy is translated in zh/en. Question and option wording comes from the agent. |

The full card is readable in the 735 px combined comparisons, so additional enlarged crops were not needed. Minor icon stroke and native font antialiasing differences are P3; exact raster equality is not claimed.

## Behavior and additional visual checks

- Real `clarify_user` → browser answer → same tool result → scratch-file write verified using a deterministic local provider.
- Complete Web browser suite 15/15: reload restores pending questions; pagination preserves text; custom Enter advances; IME confirmation does not submit; last answer sends automatically; double-click sends once; close cancels; skip is explicit; unanswered pages are not implicitly answered; failed sends retain answers and retry.
- Related coding-agent tests 49/49; Web unit tests 52/52; required `npm run check` passed.
- 390 × 740 CSS px: card width 354 px; long options wrap and card footer stays visible (`step-clarification-mobile.jpg`). Scope is the new card, not the existing narrow-screen model toolbar.
- Dark theme checked at 1280 × 720 px (`step-clarification-dark.jpg`).
- In-app browser console checked: no errors or warnings.
- Desktop-specific host validation unavailable because this worktree has no `apps/desktop`; shared React client verified in Web.

## Implementation checklist

- [x] Normalize and inspect both references beside browser screenshots.
- [x] Fix layout and typography drift, then recapture.
- [x] Verify paging, options, freeform, final auto-send and retry/cancel.
- [x] Verify responsive card and theme-token mapping.
- [x] Preserve artifacts and runtime/API documentation.

## 2026-10-14 — Approval card

final result: passed

- Source: `/var/folders/99/g1vg4kd57_lcw86v4zxzycbw0000gp/T/codex-clipboard-9c05e667-e8cd-4365-97d7-8d6c4ca0519e.png`, 1764 × 528 px; card crop normalized from 2x to 735 × 232 px.
- Implementation: same local preview in the user's in-app browser, light theme, 807 × 800 CSS px at 1x (the stream scrollbar reserves 8 px). Final card: 735 × 232 CSS px. State: pending command approval, three-line collapsed command, expand control visible.
- Evidence in the artifacts directory above: `approval-full.jpg`, `approval-card.png`, `approval-comparison.png`. Opened the combined reference/implementation comparison. Header/title, command and buttons are clearly readable at this size; no enlarged crops needed.
- Intentional differences: per the user's latest instruction, only **拒绝** and **本会话允许** are shown; no single-call button or dropdown. The example command/title is local fixture data, not the reference's gold-price query; the query in the attachment was never executed. No new global keyboard shortcuts or decorative shortcut hints were added.
- Typography: 13 px system/PingFang heading and 600-weight title; command uses the existing monospace font at 13 px / 18 px. Fonts and hierarchy follow the reference; native rasterization differences remain P3.
- Spacing: 16 px inset, 20 px radius, 20 px command gap, three-line preview, right-aligned expansion and 28 px pill actions. Initial capture was 237 px tall; removed expansion-button vertical padding and fixed header line height. Post-fix capture measured 232 px tall.
- Colors: white theme surface with a faint neutral outline, muted command text, white deny button and black session-allow button. Existing theme tokens retained; no danger-tinted card surface.
- Assets: Lucide square-terminal via the existing icon sprite, documented in provenance. No raster assets or generated imagery needed.
- Content: full captured arguments survive the Host snapshot/SSE path. Call/batch diagnostics and undefined optional fields are not displayed. File previews retain before/after and fused `then_run`; other arguments remain inspectable.
- Behavior: in-app browser verified full expansion (162 px, including end-of-command marker), collapse and refresh; console had no errors/warnings. Web e2e **17/17** includes exact two-button labels, white surface, reload restoration, double-click protection, real scratch-file creation, reuse of the session grant and deny-without-execution. Web unit tests **55/55**; `npm run check` passed.
- Desktop host remains unverified because this checkout has no `apps/desktop`. Existing unresolved follow-up is preserved in the memory vault.
- No actionable P0/P1/P2 findings remain in this approval-card scope.
