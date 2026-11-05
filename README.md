# GamePlan / Project Planner

A lightweight task-and-project board, published from this repository with GitHub Pages. The app uses a static frontend, browser-local working data, and an optional Supabase account/cloud synchronization layer. The production page is normally [GamePlan](https://pennipopvt.github.io/ProjectPlanner/).

## Working rules for future development chats

1. **Inspect the current `main` branch before editing.** Do not assume a previous chat's code or versions are current. Keep existing design language and make focused changes rather than redesigning unrelated screens.
2. **Bump the app version for every shipped change.** Find the `APP_VERSION` constant, visible `#appVersion` label, and the cache-busting `?v=` query strings in `index.html`. Update them together. Current release: **v2026.11.05.68**.
3. **Refresh the offline cache identifier** in `service-worker.js` when changing front-end assets, so older clients do not keep a stale shell. This is separate from the human-readable app version.
4. **Publish by committing to `main`.** Check the GitHub Pages build/deployment state and confirm the public URL serves the new version. If `main` is protected, create a feature branch and PR, then merge when checks permit. Never claim a successful deployment from a successful commit alone.
5. **If the page looks stale:** hard-refresh, verify the live HTML version and asset query strings, inspect Actions/Pages deployment status, and inspect the service worker/cache. Don't blindly repeat commits. See `.github/workflows/recover-pages.yml` for a *manual recovery workflow specific to a previously stale deployment*; don't run or alter it without confirming it still applies.
6. **Preserve data and sync behavior.** Browser data is persisted under `little-dock-local-v2`; project selection has its own local key. `local-first-sync.js` merges local and Supabase data. Do not casually reset keys, change IDs, or overwrite someone else's board.
7. **Use existing RPC operations for edits and logs.** `index.html` owns the local board, task and log UI; `gameplan.js` extends navigation, tags and analytics; `account-ui.js` and `local-first-sync.js` manage accounts/cloud sync. Keep new time logs compatible with the existing `logs` schema: fractional `hours` plus date, task ID, member ID, note and timestamps.
8. **Time display conventions:** show logged time as hours and minutes, not decimal hours. Manual time entries accept separate nonnegative hours and 0–59 minutes, initially 0h 0m, and must be positive before submission. Existing entries remain editable.
9. **Task stopwatch:** one running timer per member per browser, stored under `gameplan-active-clock-v1`. Starting work does not create a server log; stopping work creates an ordinary editable time log. The fixed Stop working control is shown only with an active timer. The running timer is local to that browser/device, not synchronized live between devices. Avoid double-counting elapsed time on repeated clicks.
10. **Check changed JavaScript for syntax and interaction regressions**: tasks and filters, task details, manual add/edit/delete time, the stopwatch across reloads, analytics chart types and metrics, and multi-account cloud syncing. Preserve responsive mobile layout.
11. **Do not commit private keys, login tokens, or personal board exports.** The public Supabase URL/anon key is not an admin credential. Changes to Supabase SQL/schema and authentication require checking `supabase/README.md` and possibly a separate Supabase deployment.
12. **Explain changes and link the live page and relevant commits** at the end of the work, including any deployment verification that is still pending.

## Key files

- `index.html`: primary board layout, local RPC, task actions, time-entry forms and stopwatch
- `gameplan.js`: additional pages, tags, templates, interactive charts and analytics
- `local-first-sync.js`: local-first Supabase synchronization, conflict handling, identity
- `account-ui.js`, `account-ui.css`: sign-in and account UI
- `service-worker.js`: network-first offline shell/cache
- `supabase/`: Supabase setup, schema and cloud support
- `SHARED_SETUP.md`: legacy Google Sheets / Apps Script setup notes (not necessarily the active production backend)
- `.github/workflows/recover-pages.yml`: specialized stale-deployment recovery workflow

## Release checklist

- [ ] Read latest `main`, confirm exact files and current version
- [ ] Make the smallest safe change; verify syntax and relevant interactions
- [ ] Update `APP_VERSION`, UI label, `?v=` cache-busters
- [ ] Rotate service-worker cache name if deployed asset files changed
- [ ] Commit/merge onto publishing branch
- [ ] Check GitHub Pages deployment and live HTML/version
- [ ] Verify toast notifications appear in the upper-right and dismiss automatically
- [ ] Check that account data and old time logs remain intact
- [ ] Record any limitation (such as a client-only timer) in the handoff

