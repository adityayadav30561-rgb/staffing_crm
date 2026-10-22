# Deploying for free

The whole CRM is **one web service** (it serves both the API and the web app) plus a database and a file bucket. All three fit in free plans for a 2–5 person team with a few thousand candidates.

> Free-plan limits change. The numbers below were correct when written; check each provider's pricing page when you sign up. Never paste passwords or keys into chat. Enter them only in the provider dashboards.

| Piece                | Free option                                           | What you get                                        | Catch                                                        |
| -------------------- | ----------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Database             | **Neon** (PostgreSQL)                                 | ~0.5 GB, enough for tens of thousands of candidates | Short restore history; we add nightly backups in P3          |
| Files (resumes, JDs) | **Backblaze B2** (S3-compatible) or **Cloudflare R2** | ~10 GB                                              | R2 asks for a card even on the free plan; B2 usually doesn't |
| App (API + web)      | **Render** free web service                           | HTTPS URL like `staffing-crm.onrender.com`          | Sleeps after 15 min idle; first visit then takes ~30–60 s    |
| Keep-alive           | **cron-job.org**                                      | Pings the app every 10 min so it doesn't sleep      | One free Render service fits in the free monthly hours       |
| Code                 | GitHub (already set up)                               |                                                     |                                                              |

A custom domain is optional (the domain itself costs money); the `onrender.com` address is free.

## 1. Database: Neon

1. Sign up at neon.tech → create a project (region: Singapore or Mumbai, closest to India) → database name `crm`.
2. Copy the **direct** connection string (the host _without_ `-pooler`). It looks like `postgres://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/crm?sslmode=require`.
3. That string is `DATABASE_URL`. The app creates all tables itself on first start.

## 2. File storage: Backblaze B2 (or R2)

**Backblaze B2:**

1. Sign up at backblaze.com → B2 Cloud Storage → **Create bucket**: a unique name like `yourco-crm-files`, **Private**.
2. Note the bucket's **Endpoint**, e.g. `s3.us-east-005.backblazeb2.com`. The region is the middle part (`us-east-005`).
3. Application Keys → **Add a new key** restricted to that bucket, read and write. Copy the `keyID` and `applicationKey`; the key is shown only once.
4. Env vars: `S3_BUCKET` = bucket name, `S3_ENDPOINT` = `https://s3.us-east-005.backblazeb2.com`, `S3_REGION` = `us-east-005`, `S3_ACCESS_KEY_ID` = keyID, `S3_SECRET_ACCESS_KEY` = applicationKey.

**Cloudflare R2 (alternative):** create a bucket, then an R2 API token with object read/write. `S3_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION` = `auto`.

Resumes are never public: the app hands out 5-minute signed links only to signed-in users.

## 3. App: Render

1. The code must be on the `main` branch (Claude opens the pull request; you merge it).
2. Sign up at render.com with GitHub → **New → Blueprint** → pick the `staffing_crm` repo. Render reads `render.yaml` and creates the free `staffing-crm` service.
3. Fill in the values it asks for:
   - `DATABASE_URL`: from step 1
   - `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: from step 2
   - `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`: the first admin (you). Use a strong password of at least 10 characters.
   - `SESSION_SECRET` is generated automatically.
4. Deploy. When it's live, open the URL and sign in with the admin email and password.
5. Then remove `SEED_ADMIN_PASSWORD` from Render's environment settings. It's only used to create the admin once and never overwrites anything, but it shouldn't sit there.

Each push to `main` redeploys automatically. Database changes run on start.

## 4. Keep it awake: cron-job.org

Create a free cron job: URL `https://<your-app>.onrender.com/api/health`, every **10 minutes**. Without it the app sleeps when nobody uses it. Reminders still catch up when it wakes, but the first page load is slow.

## 5. Team accounts (user IDs)

There is no public sign-up; only the admin creates accounts.

1. Admin → **Settings → Users & roles → Add user**: name, work email, role, and a temporary password of at least 10 characters.
   - **Admin**: everything, plus users and settings (usually 1 person)
   - **Manager**: all records, assigning recruiters, deletes, fees and invoices, team reports
   - **Recruiter**: works on requirements they own or are assigned to; no fees, no deletes
2. Share each temporary password privately (in person or by phone, not a group chat).
3. Each person signs in, then goes to their name (bottom left) → **My profile → Change password**.
4. When someone leaves: Settings → Users → Edit → untick **Active**. They're signed out at once and their history stays intact.
5. Forgotten password: the admin sets a new temporary one in Settings → Users → Edit.

## Live environment

- URL: _(fill in after P1)_
- Render service: `staffing-crm` · Neon project: _(name)_ · Bucket: _(name)_
