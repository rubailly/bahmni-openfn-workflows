# Provisioning: mostly RESOLVED (self-served), one narrow open detail

Original concern: "headless first-boot provisioning of a Lightning project with
credentials attached" looked blocked. **It is not.** The mechanisms shipped and
we verified them live on v2.17.1.

## Resolved (verified live)

- **Create + link a credential in one call** — the chicken-and-egg
  (`openfn deploy` resolves job credentials only from project-linked credentials,
  but the project didn't exist yet). Solved by the Credentials REST API
  (PR #3586, merged 2025-09, closes #3583):
  ```
  POST /api/credentials
  { "name": "...", "schema": "raw", "body": {...},
    "project_credentials": [ { "project_id": "<uuid>" } ] }
  ```
  Verified: created + linked `openmrs-prov` and `odoo-prov` to the project in one
  call each.
- **`/api/provision` scope** — it intentionally covers workflows/jobs/triggers,
  **not** credential bodies. So credentials being a separate REST step is the
  designed flow, not a gap.
- **Credential map** (CLI, 2026-01) exists for wiring credential UUIDs at run
  time.

## The one narrow thing still open (traced through source)

Getting the credential into the **run snapshot**. Progress (all verified live):
- `openfn pull <projectId>` populates the deploy **state** with
  `project_credentials` keyed as `hyphenate("owner name")` — this was the missing
  piece; after a pull, `openfn deploy` resolves job credential references (no more
  "Could not find"). (`mergeSpecIntoState` resolves creds from the *local state*,
  and the deploy POST response does not include `project_credentials`, so the
  state must be pulled, not just written by a prior deploy.)
- After deploy, the **live** workflow jobs have `project_credential_id` SET.

**The remaining behavior we could not resolve by reading source:** the deploy does
**not** regenerate a workflow **snapshot** carrying the credential wiring. The
single snapshot stays at `lock_version=1` with `project_credential_id = NIL`, and
runs execute against that snapshot → fail with the http adaptor's
`UNEXPECTED_RELATIVE_URL` (no `baseUrl`). We tried: (a) deploy with the pulled
spec; (b) a substantive change (cron `*/2`→`*/1`) to force a new snapshot — the
workflow stayed `lock_version=1` and no new snapshot appeared; (c) manually
`Snapshot.create/1` a `lock_version=2` snapshot with creds SET — but the workorder
still resolved to the `lock_version=1` snapshot.

**Precise question for the Lightning team:** on a headless `openfn deploy`, why is
a new credentialed snapshot not created (and how do runs pick up job credential
wiring)? Is credential-only wiring expected to bump `lock_version` / create a
snapshot, or is there a separate step? This is the ONLY thing that still needs
you — the broad "can we provision headlessly" is resolved.

## Bottom line

The big blocker is gone: credentials can be created + linked headlessly, verified
live. What remains is a narrow deploy/snapshot credential-wiring detail — likely a
CLI/credential-map usage question, not a Lightning capability gap.
