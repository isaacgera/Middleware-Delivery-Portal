# MDP Pre-Live Audit — Stage 10 (10.6)

- **Date:** 2026-11-05
- **Auditor:** Pre-Live Testing Agent (read-only), against the live app on the sample DB (admin role), at ~1366px and ~375px.
- **Verdict:** **Minor fixes first** — several accessibility gaps to close; the known `--muted` contrast issue needs a token fix. The app is close to shippable.

---

## BLOCKERS (stop the app being usable/accessible)

1. **tokens.css** — `--muted: #8a94a3` on light bg is ~2.9:1 (WCAG 1.4.3 FAIL for normal text). **Fix:** Change to `--muted: #6b7280` (gray-600, ~4.5:1 on light, ~3.8:1 on dark).
2. **#view** (index.html) — has `tabindex="-1"` for focus management but no `aria-label`. **Fix:** Add `aria-label="Main content"` to `<main id="view" tabindex="-1">`.
3. **Table rows (estimates.js, catalogue.js)** — clickable rows (`tr[data-id]`, `tr[data-variant]`) have no keyboard support (Enter/Space). **Fix:** Add `tabindex="0"` + `role="link"` + keydown handler for Enter/Space, or wrap in `<a href>`. *(Note: the Requests list already has a per-row "Open" link `<a href>`; the whole-row click is a mouse-only convenience on top of that — see triage.)*
4. **Icon-only duplicate/delete line buttons (estimates.js)** — aria-label present, but no keyboard focus style beyond global `:focus-visible`. **Fix:** Add `.line-actions .btn-ghost:focus-visible` with a distinct style.

---

## SHOULD-FIX (real gaps before go-live)

1. **Dashboard filters (reports.js)** — `<label><span>Label</span><select>` missing `for`; selects have no id. **Fix:** Add `id` to each select + matching `for` on the label (or wrap the control in the label).
2. **Catalogue pill buttons** — active state conveyed by class only. **Fix:** Add `aria-pressed` toggle.
3. **Search input (catalogue.js)** — label `<span>` not associated with `#cat-q`. **Fix:** `for`/`id` or wrap input in `<label>`.
4. **Table sort headers** — none present (column filters only). Consider sortable columns for usability.
5. **Login page (login.js)** — verify all inputs have a visible focus state with enough contrast on their backgrounds.
6. **Mobile tap targets** — line actions (duplicate/delete) are ~32px; increase to ~44×44px.
7. **Modal focus trap** — modals have `role="dialog"` but no explicit focus trap. **Fix:** trap Tab within the modal while open; restore focus to the trigger on close.
8. **Table filter row** — `.col-filter` inputs in the estimates list have no labels. **Fix:** visually-hidden label or `aria-label` (e.g. "Filter by JIRA Ref"). *(Several already have `aria-label` — confirm coverage across all columns.)*

---

## NICE-TO-HAVE (polish)

1. **Live region for actions** — add `aria-live="polite"` container for SR feedback after async actions (status change, delete, line add).
2. **Skip link** — add a "Skip to main content" link (visible on focus) at the top of `<body>`.
3. **Reduced motion on SVGs** — chart transitions should be covered by `@media (prefers-reduced-motion: reduce)`.
4. **Date input hints** — add a format hint (YYYY-MM-DD) via `title` on the date inputs.
5. **Loading states** — add `aria-busy="true"` + visually-hidden "Loading…" during async fetches.

---

## ALREADY GOOD (don't regress)

- **Keyboard nav:** global nav links, theme toggle, all dropdowns (`wireMenu`) — proper buttons; Enter/Space work.
- **Focus management:** route change focuses `#view`.
- **Semantic HTML:** `<header>`, `<main>`, `<nav>`, `<button>` for actions, `<table>` for data.
- **ARIA:** modals `role="dialog" aria-modal aria-labelledby`; icon-only buttons have `aria-label`.
- **Form labels:** Add/Edit modal inputs have a visual `<span>` label + the `.field` structure (could upgrade to real `<label>`).
- **Contrast (most tokens):** `--text` (#1a2430), `--primary` (#0a66c2), `--text-light` (#5a6675) all pass 4.5:1.
- **Print:** `@media print` hides chrome + footer; decorative PDF icons use `aria-hidden`.
- **Theme toggle:** works, persists, respects OS preference.

---

## How to verify (post-fix)
1. Contrast: browser DevTools / Lighthouse (confirm `--muted` fix in both themes).
2. Keyboard-only: Tab through the list → Enter on a row → should navigate.
3. Mobile ~375px: tap targets reachable and ≥44px.
4. Screen reader: modal focus trap, live feedback on status change, row announcements.

---

## Resolution (2026-11-05) — Isaac chose: fix all BLOCKERS + all NICE-TO-HAVE; defer SHOULD-FIX

### Fixed — BLOCKERS (all 4)
1. **`--muted` contrast** → `tokens.css` light `--muted` changed `#8a94a3` → `#6b7280` (~4.6:1, passes AA). Dark `--muted` (`#76828f` on dark ≈ 4.8:1) already passes — left unchanged (the agent's `#6b7280` would be slightly worse on dark).
2. **`#view` aria-label** → added `aria-label="Main content"` in `index.html`.
3. **Keyboard-activatable rows** → the Requests list already had a per-row `<a>` "Open" link (keyboard-OK); the real gap was the **catalogue** rows, which now have `role="link"` + `tabindex="0"` + `aria-label` + an Enter/Space keydown handler, plus a visible `:focus-visible` row style in `global.css`.
4. **Icon-button focus style** → added `.line-actions .btn-ghost:focus-visible` (filled, outlined; danger variant tinted) in `global.css`.

### Fixed — NICE-TO-HAVE (all 5)
1. **Live region** → added `#sr-live` (`role=status aria-live=polite`) in `index.html` + `announce()` in `app.js` (exposed as `window.mdpAnnounce`); wired into estimates status-change, line add/duplicate/delete.
2. **Skip link** → "Skip to main content" anchor + `.skip-link` CSS (visible on focus); click handler in `app.js` focuses `#view` without triggering the hash router.
3. **Reduced motion on SVGs** → explicit `@media (prefers-reduced-motion: reduce) svg *` guard (on top of the existing universal rule).
4. **Date format hints** → From/To date inputs now carry `title="Format: YYYY-MM-DD"` + clearer `aria-label`.
5. **Loading states** → `aria-busy="true"` + "Loading…" on the Requests list and Catalogue result containers during fetch (cleared in `finally`).

### Deferred — SHOULD-FIX (logged, not done this pass, per Isaac)
Dashboard/catalogue filter `for`/`id` label associations; catalogue pill `aria-pressed`; sortable table headers; login focus-contrast check; mobile tap-target bump on line actions; ~~explicit modal focus-trap~~ (**DONE 2026-11-06** — see below); labels on the estimates column-filter inputs.

### Follow-up — modal focus-trap DONE (2026-11-06)
The highest-value deferred should-fix is now implemented. Added a reusable `trapFocus(host, dialog,
remove)` helper in `estimates.js` and wired both modals (Add Request, Edit details): Tab/Shift+Tab
now cycle within the open dialog, **Escape** closes it, focus moves into the dialog on open, and
focus is **restored to the triggering control** on close. Verified: 38/38 tests still pass, `node
--check` clean. Browser keyboard check recommended at next sign-off (Tab should not escape the
modal; Escape closes; focus returns to the button that opened it). Remaining deferred items are all
lower-value polish.

### Not changed (confirmed good, per the ALREADY GOOD list)
Keyboard nav, dropdowns (`wireMenu`), semantic HTML, modal ARIA, icon-button labels, most token contrast, print exclusion, theme toggle.

### Verification
`node --check` clean on all edited JS; the `node --test` suite still **38/38** (edits were frontend-only). Browser sign-off pending from Isaac (contrast in both themes, keyboard row activation, skip link, print-preview footer exclusion).

---
*Report saved by Forjé from the Pre-Live Testing Agent output. Read-only audit — no files were changed by the agent; fixes applied separately by Forjé.*
