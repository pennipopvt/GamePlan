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
4. Enable the **Google** provider in **Authentication → Providers**. Configure a Google OAuth Web application using the Supabase dashboard's callback URL (not your GitHub Pages URL) as the **Google Authorized redirect URI**. Store the Google OAuth client secret **only** in the Supabase dashboard.
5. In Supabase **Authentication → URL Configuration**, add this exact allowed redirect URL:
   `https://pennipopvt.github.io/ProjectPlanner/supabase/`
   Set your Site URL to the same address if you intend to use this prototype as your primary test page.
6. Visit [the Cloud Preview](https://pennipopvt.github.io/ProjectPlanner/supabase/) and enter the Supabase **Project URL** and **publishable (or anon) key** shown in Supabase project settings. These are public client-side values; never enter a service-role key or an `sb_secret_` key.

The preview stores the Supabase URL and publishable key in **this browser's localStorage** only. OAuth sessions are managed by supabase-js.

## Test collaboration

1. Sign in with Google and create a cloud project.
2. Add a milestone, a feature, and a task. Change its status.
3. Invite a teammate by their Google-account email.
4. Have the teammate open the same Cloud Preview URL, enter the same Supabase project URL and publishable key, and sign in with the invited email.
5. After signing in, the invitation is claimed automatically. Open the project in both browsers; changing task status should update in both.
6. For migration testing, use **Copy a local project into the cloud**. The source remains in your original local browser storage.

## Current limitations

- This is a **backend and collaboration smoke test** with a small UI, not the finished GamePlan interface. The original local page remains authoritative until migration is complete.
- No server project is provisioned by committing these files; you must create a Supabase project and configure Google OAuth.
- Invites work by matching the recipient's signed-in Google email. The prototype does not send an invitation email automatically; share the preview URL separately.
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
