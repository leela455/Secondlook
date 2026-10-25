# SecondLook

Evidence-quality-aware visual inspection. This is the full-stack version of the original single-file demo: same interface, now backed by an Express API, MongoDB, real accounts, image uploads and an audit trail.

```
secondlook/
├── frontend/             the original UI (HTML/CSS/vanilla JS), now calling the API
│   ├── index.html        original styles + a few additions
│   ├── config.js         API base URL
│   └── js/api.js, app.js centralised API client, views and actions
├── backend/
│   ├── server.js, app.js startup and Express configuration
│   ├── config/           env validation, MongoDB connection
│   ├── models/           User, Inspection, Attempt, Review, AuditLog, Setting, Counter
│   ├── controllers/      thin HTTP handlers
│   ├── services/         workflow, decision rules, inspection provider boundary, analytics, settings, audit
│   ├── middleware/       auth + roles, validation, uploads, rate limits, error handler
│   ├── validators/       request schemas (zod)
│   ├── scripts/seed.js   labelled sample data + demo accounts
│   ├── tests/            unit + integration tests
│   ├── postman/          Postman collection
│   └── uploads/          stored evidence images (git-ignored)
└── docs/                 API.md, MODEL_INTEGRATION.md
```

## What it does

* **Accounts and roles**: register / sign in / sign out, JWT sessions, roles `admin`, `inspector`, `reviewer`.
* **New inspection**: upload a JPG, PNG or WEBP (max 5 MB, checked by file signature, not just the name) with a progress bar.
* **Evidence**: every upload is a separate *attempt*; recaptures never overwrite earlier evidence. Sharpness, lighting, alignment, visibility and model confidence are stored and shown separately; unavailable measurements show "Not calculated" instead of a made-up number.
* **Run Second Look**: a backend rules service decides: insufficient evidence goes to reinspection, uncertain cases go to a human, defects always need human sign-off, and nothing blurry (or failed) can ever be marked Passed. Every decision stores the rule and reason.
* **Human review**: reviewers get a queue, see the full evidence and attempt history, and approve, reject, request a recapture, or escalate to an admin. Who decided, what and when is saved.
* **Queue, evidence history, analytics, settings**: search, filter, sort, pagination; analytics computed from stored records with date filters; admin-editable thresholds.

### Inference and computer vision status

No trained industrial anomaly model or checkpoint is included. The default **demo provider** produces repeatable pseudo-scores from image bytes and is labelled as mock. The Python/OpenCV service measures sharpness and exposure. A category-aware PatchCore integration and training entrypoint are present, but no checkpoint is registered; category uploads remain quality-only and go to human review without a prediction or pass. VisA licensing is unresolved for possible commercial use: SPot-Diff lists CC BY 4.0, while Anomalib's VisA dataset source says CC BY-NC-SA 4.0. Do not download or train on VisA until the dataset provider confirms which terms govern the intended use. See [docs/MODEL_INTEGRATION.md](docs/MODEL_INTEGRATION.md).

To run the OpenCV quality service on Windows, install its dependencies and start it from the repository root:

```powershell
.\.venv-model\Scripts\python.exe -m pip install -r backend\model_service\requirements.txt
.\.venv-model\Scripts\python.exe -m uvicorn app:app --app-dir backend\model_service --host 127.0.0.1 --port 8000
```

Set `INSPECTION_PROVIDER=http` and `MODEL_API_URL=http://127.0.0.1:8001/predict` in `backend/.env` (or use another unused port), then restart the backend. The service reports `defect_model: not_configured` at `/health`; `GET /categories` reports each VisA category's readiness. A category remains unavailable until a properly licensed, trained, evaluated PatchCore checkpoint is installed. A training environment is documented, but no checkpoint is currently registered.

## Quick start (Windows)

You need **Node.js 20 or newer** (`node -v`) and **MongoDB**. Pick one MongoDB option:

* **MongoDB Community Server**: install from mongodb.com, choose "Install as a Service", then in a Command Prompt opened as Administrator: `net start MongoDB`
* **Docker Desktop**: `docker run -d --name secondlook-mongo -p 27017:27017 mongo:7`  (later: `docker start secondlook-mongo`)
* **MongoDB Atlas** (free cloud): put its `mongodb+srv://...` string in `MONGODB_URI` below.

Then, in **Command Prompt** (PowerShell equivalents in brackets):

```bat
cd secondlook\backend
npm install
copy .env.example .env                  [PowerShell: Copy-Item .env.example .env]
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Open `backend\.env` in an editor and paste that long value after `JWT_SECRET=`. Leave the rest as is for local use.

```bat
npm run seed        :: optional: sample data + demo accounts
npm start
```

Open **http://localhost:5000**. The backend serves the frontend itself, so there is nothing else to start and no CORS setup.
When using the optional Python service, start it separately on an unused port (for example `8001`) as described in [docs/MODEL_INTEGRATION.md](docs/MODEL_INTEGRATION.md).

The optional environment is pinned to Anomalib 2.7.0 with its CPU extra.

Demo accounts created by `npm run seed` (password `Demo#12345` for all):

| Role | Email |
|---|---|
| admin | admin@secondlook.local |
| inspector | inspector@secondlook.local |
| reviewer | reviewer@secondlook.local |

Without the seed script, just click "Create an account": **the first account on an empty database becomes the administrator**, every later sign-up is an inspector, and an admin promotes people from Settings → Users.

`npm run seed -- --reset` wipes all SecondLook data and reloads the samples. It refuses to run when `NODE_ENV=production`.

### Serving the frontend from another port (optional)

```bat
cd secondlook
npx serve frontend -l 5173
```

Then set `API_BASE_URL: 'http://localhost:5000'` in `frontend\config.js`. Ports 5173, 3000 and 5500 are already allowed by `CLIENT_ORIGINS`; add others in `backend\.env`. Opening `index.html` by double-clicking does not work (browsers block it); use one of the two methods above.

## Try the whole workflow in the browser

1. Run `npm run seed`, start the server, sign in as **inspector@secondlook.local**.
2. **Overview** shows live counts from MongoDB. Select **SL-1042** in the queue: you see its evidence (marked sample data), the four quality measurements, confidence and threshold, and why it needs a recapture.
3. **New Inspection**: upload any JPG/PNG. You get an ID like SL-1043 and an immediate decision with reasons. Try a `.txt` file or an image over 5 MB to see the errors.
4. If the result is *Reinspection Required*: upload a recapture (a different image gives different demo scores), watch attempt 2 appear with ▲▼ changes, then press **Run Second Look**. Repeat or press **Escalate to Human**.
5. Press F5: everything is still there (it is in MongoDB). Sign out.
6. Sign in as **reviewer@secondlook.local**: open **Human Review**, open a case, look at the attempts and timeline, and submit a decision with a comment. Check **Decided**.
7. **Analytics**: pass rate, reinspection rate, evidence-quality issues, volume and review workload; try "Last 7 days".
8. Sign in as **admin@secondlook.local**: **Settings** → raise the confidence threshold, save, and note that new inspections are judged by it.

## Tests

```bat
cd backend
npm test
```

* Unit tests (decision rules, model-output validation, image signatures, API with no database) need nothing.
* Integration tests (auth, roles, uploads, recapture, reviews, analytics, concurrency, rate limiting) need a real MongoDB. By default `mongodb-memory-server` downloads a throw-away `mongod` on the first run (needs internet, can take a minute). To use a MongoDB you already run instead:

  ```bat
  set TEST_MONGODB_URI=mongodb://127.0.0.1:27017
  npm test
  ```
  (PowerShell: `$env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017"; npm test`). Tests create and drop their own temporary database.

API requests to try by hand: import `backend/postman/SecondLook.postman_collection.json` into Postman (run a "Login" request first), or follow [docs/API.md](docs/API.md).

### What has been verified

Verified in the build environment against a real MongoDB 7.0.34 (Linux):

* 116 automated tests passing (unit + integration), including role restrictions, upload rejection (wrong type, renamed text file, oversize), recapture keeping old evidence, decision rules, review decisions persisting with reviewer and time, analytics values and date filters, concurrent Second Look calls, and rate limiting.
* 41 checks of the real frontend in headless Chromium against the running server: sign-in/out, wrong password, creating an inspection with upload, image displayed from the server, refresh persistence, recapture, Second Look, escalation, search / filter / sort / pagination, evidence history, reviewer decision, analytics + date filter, settings persisting, role-based menus, a garbage token falling back to sign-in, no horizontal overflow at desktop and phone widths, no console errors. Separately, one run confirmed the frontend served from a second port (5173) can sign in and load data through CORS.
* Not covered by the browser run: a token that expires naturally after 8 hours in the middle of a session (the server side of that is covered by an integration test, and the client code path is the same one the garbage-token check exercises).
* Startup failures print clear messages (missing `JWT_SECRET`, MongoDB not running).
* `npm audit --omit=dev`: 0 known vulnerabilities at build time.

**Not verified** (be aware before relying on them):

* Anything on Windows itself: the commands above are standard but were not run on a Windows machine. MongoDB-as-a-service, Docker and Atlas setups were not exercised.
* `npm test` using the default `mongodb-memory-server` download (the sandbox blocked that download, so the tests ran against a MongoDB I installed another way).
* Real defect detection. The demo provider is a mock; the HTTP provider was only exercised with stubbed responses, never with a real model.
* Browsers other than Chromium, screen-reader behaviour, and load / performance at scale.

## Security notes

* **Auth**: stateless JWT (HS256, 8 h by default). Passwords are hashed with bcrypt (12 rounds). The token is re-checked against the database on every request, so disabling a user, changing a role or signing out takes effect immediately (a per-user token version is bumped). Login does the same work for unknown emails to avoid revealing which exist.
* **Token storage**: the browser keeps the token in `sessionStorage` (cleared when the tab closes). That is convenient but readable by any script on the page, so keep the page free of third-party scripts. An httpOnly-cookie design would need CSRF protection and was not added.
* **Authorisation** is enforced on the server for every route; inspectors only ever see their own inspections (other people's look like 404). Status can only change through the workflow endpoints, never by editing a record.
* **Validation** of every body, query and path value (zod); MongoDB operator injection is rejected; search text is regex-escaped.
* **Uploads**: allow-listed type and extension, size limit, real file signature check, random server-chosen file names, no path traversal, files served only through an authenticated endpoint, files removed when a request fails.
* **Headers and abuse**: Helmet with a CSP, CORS allow-list, rate limits on sign-in (20 / 15 min / IP) and on uploads and decisions, JSON body limit, no stack traces in responses, request bodies and tokens are never logged.
* **CSP trade-off**: the original UI uses inline `onclick` handlers, so the policy has to allow `'unsafe-inline'` for scripts. Moving to addEventListener would let you remove it.
* **Secrets**: `.env` and `uploads/` are in `.gitignore`. Set `NODE_ENV=production`, a strong `JWT_SECRET`, serve over HTTPS (a reverse proxy) and set `CLIENT_ORIGINS` for a real deployment. Delete or change the demo accounts.
* **Data model notes**: multi-document changes use compare-and-set updates (MongoDB transactions need a replica set, which a default install is not). Deleting an inspection is a soft delete so evidence and audit history survive. Uploaded files are stored on local disk; for multiple servers use shared storage.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid configuration: JWT_SECRET ...` | You did not create `backend\.env` or left `JWT_SECRET=` empty (see Quick start). |
| `Could not connect to MongoDB` | Start it: `net start MongoDB` (admin prompt) or `docker start secondlook-mongo`; check `MONGODB_URI`. |
| Page says "Cannot reach the server" | The backend is not running, or the frontend is on another port and `config.js` / `CLIENT_ORIGINS` do not match. |
| "This page cannot talk to the server when opened as a file" | Open http://localhost:5000, not the HTML file. |
| `EADDRINUSE` | Port 5000 is taken: set `PORT=5001` in `.env` and open that port. |
| "Too many attempts" at sign-in | Rate limit; wait 15 minutes or raise `AUTH_RATE_LIMIT_MAX` in `.env`. |
| Everything shows "Demo mode" | Expected until you connect a real model ([docs/MODEL_INTEGRATION.md](docs/MODEL_INTEGRATION.md)). |
| An image shows "could not be loaded" | The file is missing from `backend\uploads` (for example it was deleted by hand). The record is intact. |
| PowerShell: `curl` behaves oddly | Use `curl.exe`, or `Invoke-RestMethod`. |
| `npm test` stalls on first run | `mongodb-memory-server` is downloading `mongod`; use `TEST_MONGODB_URI` as above. |
