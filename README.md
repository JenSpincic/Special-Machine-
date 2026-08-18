# Special Machine Talent Hub — Netlify + Clerk deployment

This turns the Claude-built prototype into a real, hosted site with:
- **Real logins** via Clerk, restricted to your company email domains
- **A real database** via Netlify Blobs (favorites, requests, internal team roster, project assignments)
- **Automatic monday.com syncing** via a scheduled Netlify Function (no more manual refreshes)

## Important, please read first

I built and syntax-checked all of this code, and tested the front end's logic against
mocked versions of Clerk/Netlify/monday.com. **I do not have the ability to run this
against your real Clerk account, Netlify site, or monday.com API from where I work** —
so treat this as a strong, well-structured first draft that needs a real test pass
after deployment, not a guarantee that every field name matches perfectly on the first
try. The monday.com sync function in particular (`sync-monday.mjs`) is the piece most
likely to need small adjustments — monday's API responses can be finicky, and I
couldn't verify the exact response shape live.

If any of this is more than you want to take on yourself, everything below is exactly
what you'd hand to a freelance developer to get this running — it should save them
real time versus starting from scratch.

## What's in this folder

```
netlify.toml              -- Netlify config (build settings + scheduled function)
package.json               -- dependencies (@clerk/backend, @netlify/blobs)
public/index.html          -- the whole site (unchanged design, new data/auth plumbing)
netlify/functions/
  sync-monday.mjs           -- scheduled: pulls fresh data from monday.com every 6 hours
  get-freelancers.mjs       -- serves the cached monday.com data to the site, fast
  me.mjs                    -- tells the front end who's signed in and what they admin
  data.mjs                  -- saves/loads favorites, requests, internal team, assignments
  _clerk-auth.mjs           -- shared helper, verifies Clerk sessions server-side
```

## Setup steps

### 1. Create a Clerk account and application
1. Go to https://clerk.com and create a free account, then create a new application.
2. In the Clerk Dashboard, go to **API Keys** and copy:
   - Publishable key (starts with `pk_`)
   - Secret key (starts with `sk_`)
3. In **User & Authentication → Restrictions**, restrict sign-ups to your company email
   domains (e.g. `specialguest.co`, `1stavemachine.com`, etc.) so this stays internal-only.
4. Open `public/index.html` and replace `YOUR_CLERK_PUBLISHABLE_KEY` (search for it) with
   your real publishable key.

### 2. Get a monday.com API token
1. In monday.com, go to your avatar → **Admin** → **API** (or your personal profile →
   **Developers**), and generate a personal API token (v2).
2. Confirm the board ID is still `7936095861` (the Golden Rolodex board) — if it's
   changed, update `BOARD_ID` in `netlify/functions/sync-monday.mjs`.

### 3. Create the Netlify site
1. Push this folder to a GitHub repo (or drag-and-drop deploy directly in Netlify's UI
   for a first pass — GitHub is better long-term so future updates are just a `git push`).
2. In Netlify, "Add new site" → connect the repo (or drag-and-drop the folder).
3. Build settings: publish directory `public`, functions directory `netlify/functions`
   (netlify.toml already sets this, so defaults should just work).
4. Netlify Blobs works automatically on any Netlify site — no extra setup needed.

### 4. Set environment variables (Netlify → Site settings → Environment variables)
| Variable | Value |
|---|---|
| `CLERK_SECRET_KEY` | your Clerk secret key (`sk_...`) |
| `MONDAY_API_TOKEN` | your monday.com API token |
| `ADMIN_EMAILS_SG` | comma-separated emails of SpecialGuest admins, e.g. `jen@specialguest.co` |
| `ADMIN_EMAILS_1STAVE` | comma-separated emails of 1stAveMachine admins |
| `ADMIN_EMAILS_PPS` | comma-separated emails of Studio PPS admins |
| `ADMIN_EMAILS_MUDGE` | comma-separated emails of Mudge admins |

Only fill in the `ADMIN_EMAILS_*` variables for companies that actually have an admin
right now — empty/missing ones just mean nobody administers that company yet.

### 5. Deploy, then seed the monday.com cache once
After the first deploy, visit (once, manually, in your browser or via curl):
```
https://YOUR-SITE.netlify.app/.netlify/functions/sync-monday
```
This runs the sync immediately instead of waiting for the first scheduled run (every 6
hours, per `netlify.toml` — change the `schedule` value there if you want it more or
less frequent). You should see a small JSON response like `{"synced": 723, ...}`.

### 6. Re-add your SpecialGuest team
The real employee roster (Maaren Hall, Dan Hall, Pimm Buddhari, May Ruzicka, Sarah
Sherman) lived in Claude's temporary storage, which doesn't carry over to this real
site. Once deployed, sign in as an SG admin and re-enter them once via **Admin →
Internal Team** — from then on it's stored for real and won't need re-entering.

## Known simplifications worth knowing about

- **Booking request write access isn't fully locked down yet.** Any signed-in user can
  currently submit *and* technically overwrite the shared request queue through the
  `data.mjs` endpoint, even though the UI only shows "Dismiss" to admins. Tightening
  this (e.g., a separate endpoint for submitting vs. dismissing) is a good next
  hardening step before this holds anything sensitive.
- **Admin write access to the shared roster checks "is this person an admin for *any*
  company," not "is this the specific company they admin."** A Studio PPS admin could
  technically edit SpecialGuest's data through the API, even though the interface
  wouldn't normally lead them there. Worth tightening later.
- **The monday.com sync function needs a real test pass** — see the note at the top.

## Questions or something breaks?

Come back to this Claude conversation any time — I have the full history of how this
was built and can help debug specific errors, adjust the monday.com field mapping, or
extend anything here.
