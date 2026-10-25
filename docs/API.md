# SecondLook REST API (v1)

Base URL: `http://localhost:5000/api/v1`. All bodies are JSON except uploads (`multipart/form-data`, field name `image`).
Authenticated routes need `Authorization: Bearer <token>`.

Every response uses one envelope:

```json
{ "success": true,  "data": { }, "meta": { "page": 1, "limit": 10, "total": 15, "pages": 2 } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid.", "details": [ { "field": "email", "message": "Enter a valid email address" } ] } }
```

Stack traces and internal error text are never returned; unexpected failures are `500 INTERNAL_ERROR` with a generic message and are logged on the server.

The examples below are real output from the running application. Windows note: in PowerShell use `curl.exe` (plain `curl` is an alias for something else) or `Invoke-RestMethod`; in Command Prompt use `curl` and `^` for line continuation.

## Status codes

| Code | Meaning |
|---|---|
| 200 / 201 | OK / created |
| 400 | validation failed, bad id, bad upload (`VALIDATION_ERROR`, `BAD_REQUEST`, `UPLOAD_ERROR`) |
| 401 | missing, invalid, expired token or signed out (`UNAUTHORIZED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`) |
| 403 | role not allowed, or not the owner (`FORBIDDEN`, `ACCOUNT_DISABLED`) |
| 404 | not found, **or not visible to you** (inspectors cannot tell other people's records from missing ones) |
| 409 | state conflict: already decided, recapture not allowed now, duplicate email |
| 413 | image over the size limit (`FILE_TOO_LARGE`) |
| 429 | rate limited |
| 503 | database unavailable (`DB_UNAVAILABLE`) |

## Roles

| Role | Can |
|---|---|
| `inspector` | create inspections, upload recaptures, run Second Look and escalate **their own** inspections; read their own data |
| `reviewer` | read everything; use the review queue (approve / reject / request recapture / escalate) |
| `admin` | everything above, plus settings, user management, assigning reviewers, deleting inspections, acting on admin-level reviews |

The first account registered on a fresh database becomes `admin`; every later sign-up is an `inspector`. A role can never be chosen at sign-up; an admin changes it with `PATCH /users/:id`.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` (password 8 to 72 chars, a letter and a number). Rate limited. |
| POST | `/auth/login` | `{ email, password }`. Rate limited (20 / 15 min / IP by default). |
| POST | `/auth/logout` | invalidates every token issued so far for this user |
| GET | `/auth/me` | current user |

```
curl -X POST http://localhost:5000/api/v1/auth/login -H "Content-Type: application/json" -d "{\"email\":\"inspector@secondlook.local\",\"password\":\"Demo#12345\"}"
```
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5...",
    "user": { "id": "6adcc6d3454bb5650508f23a", "name": "Demo Inspector", "email": "inspector@secondlook.local",
              "role": "inspector", "active": true, "preferences": { "theme": "system" }, "lastLoginAt": "2026-10-24T14:56:26.433Z" }
  }
}
```

The password hash and token version are never in any response.

## Inspections

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/inspections` | inspector, admin | multipart: `image`, `componentName`, `inspectionType`, optional `notes`, `defectCategory`, `defectSeverity`, `defectDescription` |
| GET | `/inspections` | all (scoped) | `q`, `status`, `page`, `limit` (max 100), `sort` (`createdAt, updatedAt, code, componentName, status, confidence`), `order`, `from`, `to` |
| GET | `/inspections/:id` | all (scoped) | `:id` is the code (`SL-1042`) or Mongo id. Returns `inspection, attempts, audit, reviews, permissions` |
| PATCH | `/inspections/:id` | owner / admin | `componentName`, `notes`, `defectDetails`; `assignedReviewer` is admin-only. **Status can never be set here.** |
| DELETE | `/inspections/:id` | admin | soft delete; evidence and audit trail are kept; open reviews are cancelled |
| GET | `/inspections/:id/evidence` | all (scoped) | every attempt, oldest first |
| GET | `/inspections/:id/evidence/:n/image` | all (scoped) | the stored image (needs the Bearer header, so browsers fetch it as a blob) |
| POST | `/inspections/:id/recapture` | owner / admin | multipart `image`. Only while status is Reinspection Required and the previous attempt has been evaluated. Creates attempt n+1 and keeps all earlier evidence. |
| POST | `/inspections/:id/decision` | owner / admin | `{ "action": "second_look" }` or `{ "action": "escalate", "reason": "...", "note": "..." }` |
| GET | `/inspections/:id/decision` | all (scoped) | decision history (rule, reason, who, when) |
| GET | `/evidence` | all (scoped) | evidence history across inspections, one row per attempt. `q`, `status`, `page`, `limit` |

```
curl -X POST http://localhost:5000/api/v1/inspections -H "Authorization: Bearer %TOKEN%" ^
  -F componentName="Pump Casing P88" -F inspectionType="Surface defect" -F image=@part.png
```
```json
{
  "inspection": { "id": "6adcc71a1d2c84d47cce5965", "code": "SL-1050", "componentName": "Pump Casing P88",
    "status": "Reinspection Required", "attemptCount": 1,
    "latest": { "attemptNumber": 1, "confidence": 72, "quality": { "sharpness": 64, "lighting": 76, "alignment": 55, "visibility": 88 },
                "evidenceLabel": "Insufficient", "assessmentStatus": "assessed", "sourceKind": "demo", "evaluated": true, "hasImage": true } },
  "outcome": { "status": "Reinspection Required", "rule": "EVIDENCE_INSUFFICIENT",
    "reason": "Evidence is insufficient. Alignment 55% below the minimum of 60%. Capture a better image before any decision is made.",
    "recommendations": [ "Center the component in the frame." ],
    "evidence": { "label": "Insufficient", "weakMetrics": [ "alignment" ] } }
}
```
(wrapped in the usual `{ "success": true, "data": ... }`; `sourceKind: "demo"` means the scores came from the mock provider.)

Listing:
```
GET /inspections?limit=2&sort=componentName&order=asc
{ "success": true, "data": [ { "code": "SL-1040", "componentName": "Bearing Plate C07", "status": "Defect Confirmed" }, ... ],
  "meta": { "page": 1, "limit": 2, "total": 15, "pages": 8 } }
```

Workflow rules (all enforced on the server):

* New evidence is assessed immediately. A decision is made by the rules in `docs/MODEL_INTEGRATION.md`.
* A recapture is only *stored and assessed*; the decision happens when **Run Second Look** is called. Running it twice without new evidence returns 409.
* Two simultaneous requests cannot both win (compare-and-set), the loser gets 409.

## Reviews (reviewer, admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/reviews` | `status=open|decided|all`, `type=escalation|defect_signoff`, `page`, `limit`. Open reviews are oldest first. |
| GET | `/reviews/:id` | review + all attempts + audit trail |
| POST | `/reviews/:id/decision` | `{ "decision": "approve|reject|request_recapture|escalate", "verdict": "pass|defect", "comment": "..." }` |

* `approve` on an **escalation** needs `verdict` (`pass` to Passed, `defect` to Defect Confirmed).
* `approve` on a **defect sign-off** confirms the defect (verdict must be `defect` or omitted).
* `reject` and `request_recapture` send the inspection back to Reinspection Required and need a comment.
* `escalate` hands the review to an administrator (comment required). Once escalated, reviewers get 403 and only an admin can decide.
* Every decision stores reviewer, comment, timestamp and resulting status, and writes an audit entry.

## Analytics

| Method | Path | Notes |
|---|---|---|
| GET | `/analytics/dashboard` | all-time counts for the cards: `total, reinspectionRequired, awaitingHumanReview, defectConfirmed, passed, openReviews` |
| GET | `/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | totals, `passRate`, `defectConfirmationRate`, `reinspectionRate`, evidence-quality issue counts, volume per day, recaptures per week, review workload |

Definitions: pass rate and defect-confirmation rate are shares of **finalised** decisions (Passed + Defect Confirmed); reinspection rate is the share of inspections with more than one attempt. A rate is `null` (shown as "—") when there is nothing to divide by, never a fake 0%. Dates are UTC; `to` includes the whole day.

## Settings

| Method | Path | Roles |
|---|---|---|
| GET | `/settings` | all: current rules, defaults, provider info, your profile |
| PUT | `/settings/app` | admin: `confidenceThreshold` (50-99), `minQualityScore` (20-95), `adequateQualityScore` (30-99, must exceed min), `maxAttempts` (1-10), `requireDefectSignoff` |
| PATCH | `/settings/me` | all: `name`, `preferences.theme` (`system|light|dark`) |

Unknown keys are rejected. A rule change applies to new decisions; each attempt stores the thresholds that were in force when it was evaluated.

## Users (admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/users` | `page`, `limit`, `role` |
| PATCH | `/users/:id` | `{ role?, active? }`. Cannot change yourself. Signs the user out immediately. |

## Health

`GET /health` (no auth): `200 {"status":"ok","database":"connected"}` or `503` when MongoDB is unreachable.

## Audit trail

Every important change writes an append-only `AuditLog` row (who, what, from, to, rule, reason, attempt number): inspection created, evidence uploaded, assessment completed/failed, decisions, Second Look, escalations, review decisions, edits, deletes, settings changes. There are no routes to edit or delete audit rows. It is returned inside `GET /inspections/:id` and `GET /reviews/:id`.
