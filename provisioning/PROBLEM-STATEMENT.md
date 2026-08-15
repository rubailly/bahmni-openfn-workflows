# Headless provisioning: job credentials don't reach the run snapshot

A self-contained problem statement for a self-hosted Lightning question.

## Goal / context

I'm provisioning a **self-hosted Lightning entirely headlessly** (first-boot of a
Docker stack, no UI clicks): create a project + workflow + cron trigger, attach
credentials, and have the cron run the workflow automatically. Everything via
API/CLI so it can be scripted into a container's startup.

## Environment

- **Lightning:** v2.17.1, self-hosted via Docker (`openfn/lightning` + `ws-worker`).
- **CLI:** `@openfn/cli` 1.39.4 (`@openfn/deploy`).
- **The workflow:** a cron trigger → job A (reads an HTTP feed via
  `@openfn/language-http`, needs `baseUrl` + auth from a credential) → job B
  (writes via HTTP, needs a second credential).

## What already works (verified live)

1. **User + token, headless:** `bin/lightning rpc` →
   `Lightning.Accounts.register_superuser/1` + `generate_api_token/1`.
2. **Create + link a credential in one call:**
   `POST /api/credentials` with
   `{ "name": ..., "schema": "raw", "body": {...}, "project_credentials": [ { "project_id": "<uuid>" } ] }`
   → the credential exists and is linked to the project. ✔
3. **`openfn pull <projectId>`** populates the local deploy **state file** with the
   project's `project_credentials`, keyed as `hyphenate("<owner_email> <name>")`
   (e.g. `admin@host-openmrs-cred`). This turned out to be the essential step:
   `openfn deploy` resolves job credential references from the *local state*, not
   from a fresh server fetch, so the state must be pulled first.
4. **After `pull`, `openfn deploy`** resolves the job `credential:` references (no
   more `Could not find a credential`), and the **live** workflow jobs end up with
   `project_credential_id` **set**. ✔

## The problem

Runs execute against a workflow **snapshot**. The snapshot's copy of the jobs has
`project_credential_id = NIL`, even though the **live** jobs have it **set**. So a
run executes with no credential → `language-http` has no `baseUrl` → the run fails
with `UNEXPECTED_RELATIVE_URL`.

Concretely, after a successful `openfn deploy`:

```
workflow  lock_version = 1
snapshot  lock_version = 1   (the only snapshot)
  snapshot job A -> project_credential_id: NIL
  snapshot job B -> project_credential_id: NIL
  live     job A -> project_credential_id: SET
  live     job B -> project_credential_id: SET
```

The deploy wires credentials onto the live jobs but **does not create a new
snapshot** carrying that wiring, and cron-triggered runs use the stale
(cred = NIL) snapshot.

## What I tried

- **Deploy the pulled spec** (top-level `credentials:` block + per-job
  `credential:` refs): live jobs get wired, but no new snapshot appears; runs
  still fail.
- **Force a change** (cron `*/2` → `*/1`) to trigger a new snapshot: the workflow
  stayed at `lock_version = 1` and no new snapshot was created.
- **Manually create a snapshot** (`Lightning.Workflows.Snapshot.create/1`) at
  `lock_version = 2` with the jobs' `project_credential_id` set: succeeds, but new
  work orders / runs still resolve to the `lock_version = 1` snapshot.

## The question

On a **headless** `openfn deploy` / provisioning flow, how do job↔credential
associations get into the **snapshot** that runs execute against?

- Is wiring a credential onto a job supposed to bump the workflow's `lock_version`
  and create a new snapshot? (It doesn't seem to, via `deploy` or direct edits.)
- Is there a required `deploy` step/flag (e.g. `--beta` / Pull-Deploy-Beta) or a
  specific API for associating credentials so the change is snapshotted?
- Or is the intended pattern different (e.g. credentials must exist + be linked
  **before** the first deploy of the workflow, so the initial snapshot captures
  them)?

Everything else in the headless flow works; this snapshot-vs-live credential
wiring is the only remaining gap.
