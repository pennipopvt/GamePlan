# GamePlan cloud sync (local-first)

GamePlan has **one main board**: [open GamePlan](https://pennipopvt.github.io/ProjectPlanner/index.html).

- Everything is saved immediately into browser localStorage under `little-dock-local-v2`, even if Supabase or the internet is unavailable.
- Supabase is optional for collaboration. Use **Connect Discord**, then **Share project** to publish the currently open browser project or link to an existing shared project.
- The cloud uploader preserves task IDs, all related time logs, tags, features, milestones and display names. In particular, time logs have no local `project_id`: they are included via their `task_id`.
- An explicitly linked project uses a durable local baseline plus per-row Supabase updates. Pending changes remain in the browser until they can be uploaded.
- Changes from other members are merged only when they don't conflict with local edits. Local changes to the same item take precedence. A missing/partial cloud read never silently deletes the browser copy.
- A new team member can join with the project link and their invited Discord email. A new local project is created for that team member without overwriting their other local projects.
- **Import full board** is a recovery action under the More menu, not a cloud-copy workflow. It requires confirmation, saves a prior local backup and pauses cloud syncing for review.

## Signed-in accounts, team roles and migration (2026-11-05)

GamePlan now requires an authenticated account to open its main workspace. A new account starts with an **empty workspace** and creates projects with the logged-in Supabase user as **Owner** (not the old Penni/PM sample). The main UI uses the same browser-first cache, now namespaced per Supabase user ID.

**One-time team permissions migration:** Run [team-accounts.sql](team-accounts.sql) in your EXISTING Supabase project's SQL Editor. Do not rerun `schema.sql` or delete old tables. This adds:
- A project-scoped authenticated member profile table for user-selected display names and optional links to historical task assignees.
- A secure member-list RPC that reads existing `gp_members` and real OAuth account display names.
- Owner-only name, Editor/Viewer permission and membership-management RPCs.

The migration does **not** overwrite existing projects, tasks, tags, assignments or time logs. Old member names remain accessible as historical assignees until the project owner matches them to the relevant signed-in account in **Team → Manage → Match older task assignments**. The owner's historical ID is automatically linked to the actual owner when that mapping can be verified.

**Migrating an existing browser:** When the first authenticated account opens the upgraded site, GamePlan asks whether to copy the prior `little-dock-local-v2` board into that user's private account cache or start with a blank workspace. The original key is retained as a recovery copy either way, and no server data is overwritten automatically. Each login gets a separate browser cache. Avoid choosing "Start blank" if you have offline work that has not reached the cloud.

### Login methods and identity linking

Discord is the established sign-in method. The login screen also offers Google OAuth and passwordless email magic links. Their availability depends on **Authentication → Sign In / Providers** in Supabase:
- Enable **Google** and configure its OAuth client credentials in Google Cloud before expecting Google login to succeed.
- Enable **Email** and configure an appropriate SMTP sender for reliable magic-link delivery.
- Keep the allowed redirect URL `https://pennipopvt.github.io/ProjectPlanner/supabase/discord.html` in Supabase Auth → URL Configuration. It handles all three providers.
- Enable **Manual Linking** in Supabase Auth settings to use **Account → Link Discord/Google**. Linking requires proving control of the second OAuth identity and preserves the original account; GamePlan never merges two accounts solely because of a remembered browser or email address.
- **Keep me signed in** is checked by default. Supabase refreshes the remembered session in localStorage. Unchecking uses browser sessionStorage for that new login, which lasts only for the current browser session.
- To add or change an email associated with an existing OAuth account, use **Account → Add / update email** and complete its verification message.

If a browser has no public Supabase configuration and is not entering through a project invitation, its login screen asks for the project URL and **public publishable key** once. A valid team invitation link already includes those public settings. Never put a Supabase service-role or secret key in the browser.

Project membership and permission checks are enforced by Supabase RLS, plus owner-only RPCs for managing roles. **Viewer** accounts can read team data but cannot upload edits. Cached browser data is private only to that browser profile; export backups and don't share browser profiles with untrusted people.

## Email-free Discord invite links

**One-time database upgrade for existing GamePlan Supabase projects:**
Run [link-invites.sql](link-invites.sql) in your project's Supabase **SQL Editor**. Do not rerun the complete `schema.sql` or create a new Supabase project. This migration adds an independent invite-link table and four restricted RPC functions; it does not change existing boards, task data, hours, memberships or email invitations.

After applying the migration, open the existing GamePlan main board and click **Share project**:
- Choose Editor (can edit) or Viewer (read-only cloud access), and an expiration period of 1, 7 or 30 days.
- Click **Generate invite link**, then **Copy invite link** and send it via Discord. No recipient email is required.
- The secret token is in the URL's **fragment**, so it isn't included in ordinary server requests. Supabase stores only the SHA-256 hash of each token. Each link can admit up to 25 Discord accounts.
- Recipients open the same GamePlan URL, sign in with Discord if necessary, and join automatically. Existing local data in their browser is kept separately.
- The project owner can view active/expired link metadata and **Revoke** a link from the Share dialog. Revoking stops new users joining; it doesn't kick out teammates who've already joined.
- The previous email-invitation form remains under **Invite by email instead (optional)**.

**Safety:** Treat each link like a password to join that project. Anyone who obtains it and signs in with Discord can claim its assigned role until it expires, is revoked or reaches its usage limit. Database Row Level Security still controls actual project data after redemption; nonmembers cannot access private project items.

## Cloud configuration

The Supabase project has already been provisioned and configured for Discord OAuth. New browsers may still need the Supabase **project URL** and **publishable key**, which are public client values. No secret or service-role key belongs in the browser.

If provisioning a new Supabase project, execute [schema.sql](schema.sql) first and enable Realtime publication for `public.gp_items`. Create a Discord application and configure its OAuth callback to `https://YOUR-PROJECT.supabase.co/auth/v1/callback`. Configure the allowed redirect URL `https://pennipopvt.github.io/ProjectPlanner/supabase/discord.html` in Supabase Auth URL Configuration.

The old `supabase/discord.html` is now only a callback bridge: it processes the session and automatically returns to the main board. `supabase/index.html` and `shared.html` redirect to GamePlan. The obsolete separate cloud mode has been removed.

## Deleting shared features and tasks

Deleting a feature now leaves an explicit **tombstone** inside its existing `gp_items` row. Teammates receiving that row remove the feature from their visible board; included tasks and time logs are likewise marked deleted. This prevents an outdated local cache from silently restoring a legitimate deletion.

No additional SQL setup is necessary: these markers use the existing `gp_items` schema and permissions. Browser clients retain a local deletion intent until the cloud acknowledges the marker, including if the deletion happened offline or immediately after receiving another user's feature.

For deletions made by older GamePlan releases, the sync client independently checks isolated missing records against Supabase before removing them locally. It refuses to infer a large/empty-board deletion and keeps a local recovery copy. Both collaborators should refresh the latest main GamePlan page after an upgrade.

## Data safety and limitations

- Before the first cloud link, verify the correct local project and export a JSON backup.
- When linking an existing shared project, the browser copy is uploaded without deleting additional cloud records. The existing cloud snapshot is stored locally for recovery.
- An import does **not** automatically replace server records. Sync pauses until explicitly resumed.
- The app shell is cached by a service worker after an online visit, supporting later offline loading; first-time offline loading is not supported.
- Sync is currently **beta**. Concurrent edits to the same record are last-write-wins. Missing remote rows are treated as conflicts and kept locally, which can require manual review for teammates' deletions.
- The browser's localStorage is not as durable as a backed-up database. Export periodic backups; clearing browser data can remove unsynced work.
- Project invitation access is enforced through Supabase Row Level Security. Discord-account email must match the invited address.
- Cloud configuration and browser data remain on the current device. No service-role key or Discord client secret is committed to the repository.

This is still a collaboration beta, not a fully conflict-free distributed offline database.
