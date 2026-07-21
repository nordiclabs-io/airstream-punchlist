# Sr Air Bud · Fix-It List

A shared punch-list website for the 2026 Airstream Classic 28RB Twin. The owner and the Airstream service team open the same link, enter one shared access code, and see the same floorplan, issues, photos, and notes, updated live.

Everything below is free. Total setup time: about 15 minutes. You need a computer with a web browser.

---

## Step 1 — Create the database (Supabase)

1. Go to https://supabase.com and click **Start your project** (sign up with your email or GitHub).
2. Click **New project**. Name it `airstream-punchlist`, set any database password (save it somewhere, you won't need it day-to-day), pick the region closest to you, click **Create new project**, and wait ~1 minute.
3. In the left sidebar, click **SQL Editor**, then **New query**.
4. Open the file `supabase/schema.sql` from this folder. Near the top, replace `REPLACE-WITH-YOUR-ACCESS-CODE` with the code you want to share with the dealer. Then copy **all** of it, paste it into the query box, and click **Run**. You should see "Success. No rows returned."
   - Keep the real code out of this repository — it's public. Change it later by running `update auth.users set encrypted_password = extensions.crypt('NEW-CODE', extensions.gen_salt('bf')) where email = 'crew@srairbud.app';`
5. In the left sidebar, click the **gear icon (Project Settings) → API**. Keep this page open — you'll need two values in Step 3:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

## Step 2 — Put the code on GitHub

1. Go to https://github.com and sign up / sign in.
2. Click the **+** in the top right → **New repository**. Name it `airstream-punchlist`, leave it **Public** (or Private — both work), and click **Create repository**.
3. On the new repo page, click the link **"uploading an existing file"**.
4. Drag **the contents of this folder** into the upload box — all files and folders (`src`, `public`, `supabase`, `package.json`, `index.html`, `vite.config.js`, `.gitignore`, `README.md`, `.env.example`).
   - Tip: select everything *inside* the folder, not the folder itself.
5. Click **Commit changes**.

## Step 3 — Deploy on Vercel

1. Go to https://vercel.com and click **Sign Up → Continue with GitHub**.
2. Click **Add New → Project**, find `airstream-punchlist` in the list, and click **Import**.
3. Vercel auto-detects Vite. Before deploying, open **Environment Variables** and add these two (from the Supabase page you kept open in Step 1):
   - Name: `VITE_SUPABASE_URL` → Value: your Project URL
   - Name: `VITE_SUPABASE_ANON_KEY` → Value: your anon public key
4. Click **Deploy**. In about a minute you get a live URL like `https://airstream-punchlist.vercel.app`.
5. Open it and enter your access code. The first visit automatically loads the 23 shakedown issues. Add a test note, refresh — it should still be there ("Saved ✓" in the header).

**Send that URL and the access code to the dealer.** They enter the code once per device; after that it opens straight to the list. The **Lock** button in the toolbar signs a device back out.

---

## Day-to-day

- **Updates sync live** — when the dealer changes a status or adds a note, you see it within a second, and vice versa.
- **Photos** are stored full-quality in a private Supabase Storage bucket (1 GB free — roughly 3,000+ photos at the app's compression) and shown through short-lived signed links, so they aren't readable without the code.
- **"Demo mode"** in the header means the two environment variables are missing or wrong — recheck Step 3.3 in Vercel (Settings → Environment Variables), then redeploy (Deployments → ⋯ → Redeploy).

## Making changes later

Ask Claude to modify any file, then on GitHub open that file → click the pencil icon → paste the new version → **Commit changes**. Vercel redeploys automatically in ~1 minute at the same URL.

## Good to know

- Anyone with **both the URL and the access code** can view and edit the list. Everyone shares one code, so there's no per-person history — the "Your name" field on a note is how you tell who wrote what.
- The code is the only thing protecting the data. The sign-in email is visible in the site's JavaScript, so a determined attacker would only need to guess the code; Supabase rate-limits sign-in attempts, but a longer code is meaningfully stronger than a short numeric one.
- To wipe everything and restart with the original 23 issues: in Supabase → SQL Editor run `delete from issues;` — the app re-seeds on the next visit.
