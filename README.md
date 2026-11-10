# GamePlan / Project Planner

A lightweight task-and-project board, published from this repository with GitHub Pages. The app uses a static frontend, browser-local working data, and an optional Supabase account/cloud synchronization layer. The production page is normally [GamePlan](https://pennipopvt.github.io/ProjectPlanner/).

## Working rules for future development chats

1. **Inspect the current `main` branch before editing.** Do not assume a previous chat's code or versions are current. Keep existing design language and make focused changes rather than redesigning unrelated screens.
2. **Bump the app version for every shipped change.** Find the `APP_VERSION` constant, visible `#appVersion` label, and the cache-busting `?v=` query strings in `index.html`. Update them together. Current release: **v2026.11.10.85**.
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


## Compact milestone imports and remaining work

- The **Import milestone** action accepts a standalone milestone JSON file; it adds a milestone to the selected project without replacing other tasks, tags, or logs. See [MILESTONE_IMPORT.md](MILESTONE_IMPORT.md) for the compact format.
- Imported tasks support `estimated_minutes`, display-name assignees, multiple named tags and tag colors. Existing tags are reused by name.
- Remaining hours are **calculated**, not edited: an unfinished task has `max(0, estimated hours - logged hours)` remaining, and a completed task has zero. Summaries and charts use the same calculation. Exported full backups include the calculated value for compatibility with older clients.

## Board navigation and milestone filtering

- The **Board** sidebar item always opens the single Project Overview board. The legacy "All/Open/Completed/Milestone" sidebar subtabs and their hidden selection state have been removed.
- Use the **All milestones** dropdown in the Board filter bar to show every milestone (default) or one milestone. The advanced Filters menu continues to handle status, tags, assignees and priority.
- Newest milestones appear first. Newly created/imported milestones record creation timestamps; older milestones fall back to target date and their saved order.
- After importing a milestone, GamePlan returns to the full Project Overview and clears leftover search, My tasks, assignee and advanced filter selections. The import remains additive.

## Configurable Project Overview stats

- The Project Overview defaults to five statistics: Total tasks, Tasks remaining, Completed, Time logged, and Time remaining. Estimated time is optional.
- Use **Customize** beside *Overview stats* to check or uncheck each statistic. The selection persists per project and signed-in local identity on the current device, without changing cloud board/task data.
- Every statistic reflects the currently visible, filtered tasks, including the **All milestones** selector, My tasks, search, and faceted filters. Tasks remaining counts unfinished tasks, and Time remaining sums the existing calculated task remaining hours (completed tasks contribute zero).
- The settings menu remains accessible even if all statistics are unchecked.

## Analytics: weekly work and feature time

- Analytics opens with a **vertical grouped bar chart**: one bar per team member, grouped by Monday-start calendar week. Hours are credited to each time log's `member_id` rather than the task assignee.
- An optional **Team velocity** line overlays a trailing three-week moving average of **total team hours logged per week**, on the same hours axis. It can be toggled off without changing logged data.
- Simplified settings appear **below** the graph: Milestone (all or individual), Weeks (4, 8, 12, all logged weeks), and Velocity overlay. Milestone selection filters both the chart and feature list.
- A feature-time breakdown **below the chart settings** groups features by milestone and lists logged, estimated, remaining, and completed task counts. Remaining time uses the existing calculated task remaining hours; Done tasks contribute zero.
- Week buckets use each log's work date and Monday as the start of the week. Invalid or undated time entries are omitted from weekly bars, but remain counted in feature-level logged totals and are noted separately. No underlying task or time-log data is modified by this page.

## Analytics: daily intervals, primary tags and member colors

- Analytics supports **Daily** or **Weekly** intervals, with vertical adjacent bars grouped by either **Team members** or **Task tags**. The selected milestone filters both charts and feature breakdowns. Daily ranges are 7/14/30/all logged days; weekly ranges are 4/8/12/all logged weeks.
- Bars by tag use the project tag's actual color. For tasks with multiple tags, their logged hours are attributed to the **first (primary) task tag only**, preventing one time entry from appearing multiple times in a total; untagged work has a neutral gray. Changing tag colors in Project Settings updates the chart.
- Bars by member use the team member's consistent **chart color**, editable in **Team > Chart colors** (or directly in the local Team list). The chosen `chart_color` field is stored on the existing project `team` record and uses the current cloud sync's `team` kind, rather than a browser-only preference. Unset colors get a stable deterministic fallback. Editing team colors requires project edit permissions; the authenticated team permission model is unchanged.
- Velocity remains an optional line: a trailing **7-day moving average** for daily intervals or **3-week moving average** for weekly intervals, of total team logged hours per period.
- Feature time remains grouped by milestone, with a **Sort milestones** selector for newest-first or oldest-first. Logged, estimated, remaining, and completed task counts are unchanged.

## Shared team and tag color picker

- **Team > Chart colors** now opens the **same palette modal** used by Project Settings > Tags, rather than a native browser color input. The authenticated Team page and local Team page both use this modal.
- Both dialogs share one implementation of the preset swatches, selected state, inline saturation/value box and rainbow hue slider, color preview, added custom swatches, right-click delete, and clearing custom palette colors.
- Custom palette swatches remain project-scoped and synced through `custom_tag_colors`; member colors continue to save to the team record's `chart_color`. Choosing a new member color does not modify existing tag colors. Clearing a custom palette swatch does not change saved member or tag colors.
- Team color editing still requires project edit permission. The color choice only saves when the user presses **Save color** in the modal.

## Team member colors in Manage, hex color input, and Board assignees

- In the signed-in **Team** page, the separate Chart colors section has been removed. Use each person’s **Manage** dialog (including the owner’s) to expand **Chart color**, select a preset or custom color, and save it along with other member settings. The local Team page uses the same approach.
- The **shared tag/team palette** includes an editable **hex color** field supporting `#RRGGBB`, `RRGGBB`, `#RGB` and `RGB`. It updates the selected swatch and preview; invalid text blocks saving. A newly typed custom hex is added to the shared project palette only when changes are saved.
- **Board task assignees** and the task detail’s Assigned to label display a subtle colored dot based on that person’s synchronized team color. The existing **You** label remains intact. Unassigned tasks show no color marker.
- Chart color settings remain stored in each project team member’s existing `chart_color` field. No existing team colors, tasks, time logs, or tags were migrated or overwritten.

## Discord avatars with member-color borders

- **Team** displays round profile portraits with each member's existing chart color as the border, and improved name/role/Manage spacing. The old tiny name-side color dots are removed.
- **Board** assignees and the task-detail "Assigned to" field show a compact round avatar with that same colored border, replacing the tiny colored dot. The "You" label is unchanged. Missing, invalid, or broken image URLs fall back to an initial in a color-bordered circle.
- Avatar URLs are read from each member's Discord OAuth public avatar metadata, validated against Discord CDN hosts, and are not copied into task records. GamePlan does not make separate Discord API requests.
- **Supabase setup for teammates' pictures:** Run (or rerun if previously installed) [`supabase/team-avatars.sql`](supabase/team-avatars.sql) in your project's Supabase **SQL Editor**, after the existing team-accounts setup. Then reload GamePlan or click Sync. The additive function prioritizes any linked **Discord OAuth identity's** avatar URL, including on accounts whose primary sign-in is Google or email, then falls back to the main user profile's Discord avatar. It exposes only a public Discord CDN avatar URL to signed-in members of the same project. It does not change membership, project tasks, or time logs.
- Until this optional SQL migration is applied, the signed-in user's Discord picture may appear from their own login metadata, while other people show color-bordered initials. Likewise, non-Discord sign-in accounts or accounts without a public Discord avatar use initials. When a user changes their Discord picture, it may take a later OAuth refresh/sign-in for Supabase's stored avatar metadata to update.

- **If only one teammate still has initials:** Ask that teammate to open **Account → Sign-in methods → Link Discord** in GamePlan if Discord is not yet linked. Linking must be done from the same existing GamePlan account, rather than signing in as a different/new account, to preserve project membership. If already linked, sign in again with Discord to refresh stale OAuth avatar metadata.

## Account linking prerequisite and simplified Team management

- To use **Account → Link Discord / Link Google**, the Supabase workspace administrator must enable **Authentication → Settings → Allow manual linking** in the Supabase Dashboard. Supabase disables manual OAuth identity linking by default; GamePlan cannot toggle this server-side authentication setting. The Account dialog now explains this prerequisite and displays a targeted message when linking is disabled. OAuth linking verifies the provider identity; it is not a migration/merge of two existing Supabase accounts. See [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
- **Team → Manage** no longer shows the old **Match older task assignments** dropdown or unmatched-assignee panel. Existing project member-to-assignee mappings (`legacy_member_id`) are retained internally and supplied unchanged when saving display name/permissions. This preserves existing historical task ownership, hours, member chart colors, avatars, and synced data. The SQL compatibility field remains in place; no schema migration is needed.

## GamePlan-wide invites vs project-specific invites

- **New:** App-wide access invites let someone use GamePlan and create their own cloud-backed projects without joining yours. Existing Supabase Auth users are grandfathered into app access on the first migration, but **only the one explicitly designated GamePlan owner** can create or revoke app-wide invite links.
- **Still available:** Project invite links add someone to one particular shared project, without granting access to unrelated projects.
- To enforce new app signup approval and enable app-wide invitation links, run [`supabase/app-invites.sql`](supabase/app-invites.sql) once against your existing Supabase project. It leaves the board intact and adds an RLS project-creation restriction. The SQL migration must be run manually; committing GitHub code is not enough.
- To authorize **only your account** to invite users to GamePlan, run [`supabase/owner-only-invites.sql`](supabase/owner-only-invites.sql) afterward, entering your own Auth user UUID in the Supabase SQL Editor (not GitHub). This safely removes other app-invite administrators from older setups, keeps project invitations unchanged, and enforces a one-admin limit.
- For **automatic Supabase connection on new browsers**, fill the public URL and `sb_publishable_` value in [`supabase/public-config.js`](supabase/public-config.js). Never commit a secret/service-role key. Until then, both app and project invitation URLs auto-populate the public configuration for recipients, and existing browsers keep saved settings.
- See [`supabase/README.md`](supabase/README.md#app-wide-invitations-and-default-supabase-connection-v2026110778) for the install and access model. Local legacy project uploads still require confirmation to avoid overwriting unsynced browser data; authenticated newly created projects already use Supabase automatically.

## Editorial milestone header preview (v2026.11.07.80)

The Board’s milestone headers use the approved **Editorial / Design A** preview: a small numbered milestone eyebrow, larger 25px milestone title (21px on small screens), description on its own line, target date on top, and a separate task-progress row with hours at the end. Milestone cards have a subtle lavender 1px edge instead of a thick dark outline. Existing collapse/expand behavior, feature/task hierarchy, edit and add buttons, status colors, time totals and project data are unchanged. This is a reversible visual experiment; compare in the real Board and adjust after feedback.

## Milestone visual refinements (v2026.11.07.81)

- Keep the large **Editorial** milestone title while adding a **5px magenta left rail** inspired by Accent Rail.
- Allow long milestone descriptions and the progress footer to extend across the card, instead of truncating the description to 70 characters' worth of width. The logged/remaining time line aligns at the right edge, like the target date, with responsive wrapping for narrower screens.
- Automatic milestone labels count **oldest to newest** (01, 02, 03, …), while the Board continues to display the **newest milestone first**. Filtering down to a milestone doesn't change its number. Older projects use the existing target-date and stored-position fallback when creation timestamps are absent.
- In **Create milestone** or **Edit milestone**, the optional **Milestone number** field accepts integers 1–9999. Clearing it restores automatic numbering. This cosmetic `display_number` is saved on the milestone itself and syncs with the same payload; the milestone's name, order, feature/task records, logged hours and permissions stay unchanged.

## Shared project deletion, neutral typography and private drafts (v2026.11.07.82)

**Owner-only cloud deletion.** Project Settings → Delete project now permits deleting a cloud-linked project, including the last project. It requires an explicit destructive confirmation followed by typing its exact title. It stores a recovery snapshot in browser localStorage BEFORE sending an authenticated Supabase `gp_projects` DELETE scoped to the authenticated owner, and only removes the local project/cache link after the server confirms one row deleted. Deleting the project cascades to cloud memberships, invites and all cloud project items, leaving unrelated projects alone. If the server request fails, the local copy and connection are untouched. Other teammates lose cloud access, but copies they had previously downloaded onto their own devices cannot be remotely erased. A post-deletion local-storage failure leaves a named recovery snapshot.

**Typography.** Replace the leftover green project-heading and feature time/title text with neutral charcoal and mauve-gray while keeping meaningful task status colors.

**Private drafts — device-local initial release.** A project owner can tick **Save as private draft** when creating a milestone or task. Draft milestones, their features/tasks, and private tasks' time logs are excluded entirely from the ordinary team-visible `gp_items` Supabase sync. The owner sees labeled drafts in their Board and may **Publish** a private milestone (including its children), private feature, or private task. Publishing adds the records to normal shared sync, where everyone on the project can see them. Features created under an unpublished milestone, including template-based ones, inherit privacy. The owner controls drafts; Editors and Viewers do not see drafts or receive them through project sync.

**Important limitation:** Until publishing, draft contents are stored **only in the owner's current signed-in browser account cache**. With the private-drafts SQL migration installed, they sync to the owner's own account-private table rather than team-visible gp_items. Export a backup before clearing the site cache or changing browsers. Existing public tasks cannot be made retrospectively secret: the setting is offered when *creating* new work, not on already published items. The published project data is unchanged until the owner publishes drafts.

## Editable privacy on existing milestones, features and tasks (v2026.11.07.83)

**Private draft** is now an owner-only editable property in the existing **Edit milestone**, **Edit feature**, and **Edit task** dialogs, including items that were previously published. Uncheck the same property to publish again. A private milestone automatically keeps all of its features, tasks and logs unpublished; a private feature similarly hides its tasks and logs. Children of an unpublished parent show a disabled inherited checkbox until their parent is published.

When converting **previously published** content to private, GamePlan displays a destructive privacy warning and, while online, first submits **a single atomic batch of tombstones** for the root record and all its publicly shared descendants to Supabase `gp_items`. It checks that every record was acknowledged **before** updating the local private flag. If Supabase rejects the operation, the item stays published locally and an error appears. This is stronger than simply hiding it with CSS or filtering only on the owner's device.

Already-downloaded copies on teammates' browsers **cannot be retroactively erased**. New unpublished edits are visible only in the owner's current browser account cache; they are excluded from normal shared sync until republished. A recipient with an out-of-date cached board may need to sync to receive the removal. No new Supabase SQL migration is required; existing project-owner permissions and per-record tombstones are reused.

Data is never removed from the owner's private board during the transition; milestones' features/tasks and tasks' time logs remain available locally, with their original identifiers and logged hours preserved. Only a project owner sees the privacy controls, and successful publication restores normal cloud sync.

## Board/UI polish and future custom domains (v2026.11.07.84)

- The owner-only milestone and feature **Publish** buttons now have a natural min-width and 32px height. Earlier highly specific icon-control styles mistakenly forced the milestone button to 32px width and clipped the text.
- The milestone disclosure caret is vertically centered against the full milestone summary, even with a description and progress row; mobile alignment is consistent.
- **Project Settings → Project Tags / Danger Zone** headings and explanation use neutral charcoal and muted mauve instead of inherited green text. The destructive action retains intentional red styling.
- Authentication callback URLs (Discord, Google, email sign-in and linked identity) now derive from the site's current document base path instead of hardcoding `/ProjectPlanner/`. The original GitHub Pages address behaves the same, and a future custom domain at the site root can use `/supabase/discord.html`.

**Future custom domain:** No `CNAME` file, GitHub Pages setting or DNS records are changed in this release. When a domain has been registered by the project owner, add it under **GitHub repository → Settings → Pages → Custom domain**, point DNS at GitHub Pages, and turn on HTTPS. Add the new `https://YOUR-DOMAIN/supabase/discord.html` to **Supabase Authentication → URL Configuration → Redirect URLs** before testing Discord/Google/email authentication. Keep the old GitHub Pages callback temporarily while moving existing users/invite links. The `gameplan.com` name is already used by another education platform, so choose and verify a different available domain before purchasing.


## Release 2026.11.10.85

- Merge account-private draft synchronization (requires `supabase/private-drafts.sql` migration), editable private draft controls, published-record unpublishing, and milestone feature reordering.
- Fully completed features sort to the bottom while preserving manual order.
