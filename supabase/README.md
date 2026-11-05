# GamePlan Cloud — initial Supabase test

This is a **separate opt-in prototype**, not a replacement for the working local GamePlan. Do not delete the existing Google Sheets app or your local browser data during setup.

## Why Supabase?

- Google Sheets/Apps Script uses an iframe and message/response requests for each operation.
- Supabase offers direct database APIs and realtime subscriptions with per-project access control.
- Individual records are stored separately to avoid overwriting the entire board on every edit.
- Actual performance depends on network conditions; test with two browsers before migrating the main interface.

## Set up the database

1. Create a Supabase project at https://supabase.com/dashboard.
2. In **SQL Editor**, execute [schema.sql](./schema.sql). It creates projects, memberships, invitations and item rows with Row Level Security.
3. In **Database → Publications**, enable realtime publication for `public.gp_items`. Only run `alter publication supabase_realtime add table public.gp_items;` once if it is not already enabled.
4. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a Discord app. In **OAuth2 → Redirects**, add the callback URL shown under **Supabase → Authentication → Sign In / Providers → Discord**, then save. Enable Discord in Supabase and enter your Discord Client ID and Client Secret there. Never put the secret in GitHub.
5. In Supabase **Authentication → URL Configuration**, add this exact allowed redirect URL:
   `https://pennipopvt.github.io/ProjectPlanner/supabase/`
   Set your Site URL to the same address if you intend to use this prototype as your primary test page.
6. Visit [the Cloud Preview](https://pennipopvt.github.io/ProjectPlanner/supabase/) and enter the Supabase **Project URL** and **publishable (or anon) key** shown in Supabase project settings. These are public client-side values; never enter a service-role key or an `sb_secret_` key.

The preview stores the Supabase URL and publishable key in **this browser's localStorage** only. OAuth sessions are managed by supabase-js.

## Test collaboration

1. Sign in with Discord and create a cloud project.
2. Add a milestone, a feature, and a task. Change its status.
3. Invite a teammate by the email associated with their Discord account.
4. Have the teammate open the same Cloud Preview URL, enter the same Supabase project URL and publishable key, and sign in with their Discord account using that email.
5. After signing in, the invitation is claimed automatically. Open the project in both browsers; changing task status should update in both.
6. For migration testing, use **Copy a local project into the cloud**. The source remains in your original local browser storage.

## Full shared GamePlan interface (Cloud beta)

The **complete local layout and features** now run in a second mode on the *same* `index.html` and `gameplan.js`:

- **Local:** https://pennipopvt.github.io/ProjectPlanner/index.html
- **Cloud beta:** https://pennipopvt.github.io/ProjectPlanner/index.html?cloud=1

After signing in via `supabase/discord.html` and importing a local project, open the full cloud page. It reuses the exact board, filters, task editing, templates, analytics, time logs, and drag handles. The additional `cloud-mode.js` adapter loads the signed-in user's cloud projects, writes changed rows individually to Supabase, listens for team changes, and exposes a **Share project** button for owners.

Cloud mode uses a **different localStorage key**, so it does not overwrite your original local Fishing Game project. Supabase remains authoritative for cloud data. The original Google Sheets site is not required.

### Important beta notes

- **Test on a small project first.** Cloud mode passed JavaScript syntax checks, but realtime collaboration and every complex editing path have **not yet** been verified in a browser with multiple accounts.
- Cloud synchronization is *optimistic* and queued. The status near the header reports sync errors. Do not treat unsynced changes as saved; retry after fixing errors.
- Updates to *different* items are independent, but concurrent edits to the same item are **last-write-wins**.
- Offline editing and reliable conflict merging aren't implemented.
- Project invites use the teammate's **Discord account email**, which must match their sign-in email. Share the GamePlan URL yourself; inviting doesn't automatically send an email.
- Existing imported task assignees use their original legacy IDs. Invited Discord users are distinct account members until explicitly assigned; the member display names are stored with project team items on subsequent saves.
- Viewers have database-enforced read-only access. For now, use **Editor** invitations for actual collaborators.
- A manual **Sync** button is available if an incoming update couldn't be shown during a modal edit.

## Current limitations

- This is a **backend and collaboration smoke test** with a small UI, not the finished GamePlan interface. The original local page remains authoritative until migration is complete.
- No server project is provisioned by committing these files; you must create a Supabase project and configure Discord OAuth.
- Invites work by matching the recipient's signed-in Discord account email. The prototype does not send an invitation email automatically; share the preview URL separately.
- Local team members and historical assignee IDs are preserved as data, but have **not** yet been mapped to authenticated Supabase user accounts.
- Import creates a new cloud copy; it does not merge with an existing cloud project.
- Save operations are per item, but concurrent edits of the *same task* are currently last-write-wins. Conflict handling/offline queuing and full production migration are still future work.
- Cloud Preview supports only minimal project/milestone/feature/task creation, status editing, and invitations. More GamePlan UI features must be connected to the backend before switching the main app.
- Members currently have an owner/editor/viewer role in the database; the preview exposes invite-by-email for the project owner.
- The Supabase free plan may pause projects after inactivity; see current pricing.

## Security

All cloud rows use RLS: project members can read them, editors/owners can change items, and only owners can issue invitations. Do not commit any Google OAuth secret or Supabase service-role token. Review database policies and test cross-project access before letting a larger group use this.

## Next engineering phase

Add a cloud-backed data adapter to the full `index.html` interface, keeping local mode as an option. Map roster members to authenticated accounts, handle realtime selective updates without disrupting in-progress forms, and verify conflict behavior and backup/rollback.
