# Project Planner — Google Sheets Shared Mode

The existing **Local board** is intentionally still available at `index.html`. This separate **Shared board** (`shared.html`) is designed to connect to the existing [Project Planner — Shared Data](https://docs.google.com/spreadsheets/d/1wDqr3NxhHD7VnvniFQHfJ6zhT9DHzB0y7wfTjVPZMGQ/edit). The site's public GitHub repo contains **no passwords, API keys, or tokens**.

## Architecture

- `shared.html`: GitHub Pages front-end and Google Identity Services login.
- `shared-config.js`: public Google OAuth client ID and Apps Script deployment URL (neither is secret).
- `Code.gs` + `Bridge.html`: Google Apps Script project, deployed as a web app **executing as the owner**; backend writes to a private sheet after verifying a Google-signed ID token.
- A sandboxed Apps Script iframe transfers a `MessagePort` to the GitHub Pages front-end. The bridge uses `google.script.run` to communicate with the server without opening a cross-origin public Sheets API or posting raw tokens to GitHub. If your browser blocks third-party iframe communication, test with another browser or consider moving the entire interface into Apps Script HTML Service.

## One-time setup (Google account that owns the sheet)

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create/select a Google Cloud project, configure the OAuth consent screen, and create an **OAuth client ID → Web application**. Under **Authorized JavaScript origins**, add `https://pennipopvt.github.io`. Do not add a redirect URI for the GIS credential-button flow. Note the client ID (ending in `.apps.googleusercontent.com`). If the consent configuration is in *Testing*, add all teammates' email addresses as test users (or publish the app as appropriate).
2. At [script.google.com/home/projects/create](https://script.google.com/home/projects/create), create a standalone Apps Script project **while signed in as the account that owns the Google Sheet**. Replace the default code with the contents of `apps-script/Code.gs`. Add a new **HTML** file named `Bridge` and paste the contents of `apps-script/Bridge.html` into it. The manifest `apps-script/appsscript.json` is optional; if using it, enable **Show appsscript.json manifest file in editor** in Project Settings and paste it.
3. In Apps Script **Project Settings → Script properties**, add `GOOGLE_CLIENT_ID` with the same OAuth web client ID. There are no secrets in `shared-config.js`.
4. **Deploy → New deployment → Web app.** Set **Execute as: Me** (the spreadsheet owner), and **Who has access: Anyone**. The backend is publicly embeddable but rejects all data requests without a valid Google ID token from the configured client ID and an active member record. Authorize the requested Sheets and outbound-request scopes as the owner. Copy the `/exec` deployment URL.
5. Edit `shared-config.js` in GitHub: fill `appsScriptUrl` with that exact `/exec` URL and `googleClientId` with the OAuth client ID. Commit. Visit [the shared board](https://pennipopvt.github.io/ProjectPlanner/shared.html) and sign in.
6. Sign in as `penniepop.vt@gmail.com` (initial PM identity). If you use another Google account, replace the email in `Members!C2` with the intended account before signing in. The backend recognizes members by verified email, *not* by typed names.
7. As PM, use **+ Member** to enter each teammate's exact Google email. The existing Ethan, Jerry and Jenny membership rows are marked **Pending verification**, so they cannot access project data until their addresses are filled and activated. Share the **shared board URL**, not Editor access to the Sheet, with teammates. If you want teammates to inspect the raw sheet, share it as **Viewer**, not Editor; direct Sheet editing would bypass web-app role restrictions.

## Role behavior

- **PM:** create projects, milestones, features, tasks, assignments, and team memberships; edit any task; update status and log hours.
- **Member:** see projects they're members of, open full task descriptions, change status on **their assigned tasks**, and log their own work.
- The server checks project membership on **every request** and obtains identity from a Google-signed ID token. It never trusts a role, email, or assignee claimed by the browser.
- No general deletion UI yet. The initial shared sheet is intentionally empty of tasks; export the original local board before migrating to avoid losing work.

## Notes and limits

- This does **not** modify your existing local board, its browser storage, or task backups.
- GitHub Pages still serves the shared front-end. Changing frontend files on GitHub updates it after refresh. Apps Script **backend** changes require publishing a new deployment version (Deploy → Manage deployments → Edit).
- A Google Sheets backend is appropriate for a small team, not high-volume concurrent editing. Writes use Apps Script's script lock, but external edits in the raw Sheet bypass backend validation. Keep direct Sheet editor access restricted to PMs.
- This is a ready-to-deploy implementation, not a completed live connection. Do not assume roles are enforced until the Apps Script deployment, Google sign-in and a real PM/member test have succeeded.
- If the Google Identity Services sign-in button does not load, check browser tracking restrictions, consent screen test-user access, and exact authorized JavaScript origin.
- If the bridge does not connect, check the `/exec` URL and Apps Script web-app access settings; browser cross-origin iframe restrictions may require a different hosting architecture.

## Updating the backend after GitHub changes

The GitHub Pages UI updates after a refresh, but Apps Script does not automatically pull GitHub code.

1. Open your existing Apps Script project, `Project Planner`.
2. Replace the contents of its `Code.gs` with the current [apps-script/Code.gs](apps-script/Code.gs) from GitHub. Keep the existing `Bridge.html`.
3. Save. Choose **Deploy → Manage deployments**, select the existing web-app deployment, click its pencil (**Edit**), and choose **New version**. Click **Deploy**. Keep **Execute as: Me** and **Who has access: Anyone**.
4. Reopen the [Shared board](https://pennipopvt.github.io/ProjectPlanner/shared.html), hard-refresh, and test editing the first milestone. Using **Manage deployments** keeps the existing `/exec` URL, so `shared-config.js` does not need changing.

## Inviting project teammates

1. The PM uses **+ Member** on the shared board and enters each person's actual Google sign-in email. This activates any matching pending roster entry.
2. If the Google OAuth consent app has **Testing** status, open **Google Cloud Console → Google Auth Platform → Audience → Test users** and add those email addresses there as well.
3. Share [the shared-board link](https://pennipopvt.github.io/ProjectPlanner/shared.html) with teammates. They sign in with that same Google account. Do **not** grant them Editor permission to the raw spreadsheet or they could bypass the PM-only restrictions.
4. Verify with one member account: it should view tasks and update only its assigned tasks, and have no buttons to edit milestones/features or create/assign tasks.

The PM can now edit milestone name, description, status and target date; edit feature name, description, parent milestone, status and estimated hours. These edits require the new Apps Script backend version.

## Deleting tasks, features, and milestones

The PM can delete a task from its Edit dialog. This permanently removes the task and its time logs after a confirmation. A feature cannot be deleted while it has tasks; a milestone cannot be deleted while it has features. Move or delete children first, then delete the parent. Non-PM members have no delete permission. Changes require saving the updated `apps-script/Code.gs` into Apps Script and publishing a new web-app version via Deploy → Manage deployments → Edit → New version; GitHub frontend changes appear after a hard refresh.

The **+ Invite member** button is beside **Project team**, not in the Project board. Adding a member authorizes their Google email for that project; it does not send an invitation email automatically. Share the shared-board link yourself. In OAuth Testing mode, add the same email under Google Auth Platform → Audience → Test users.
