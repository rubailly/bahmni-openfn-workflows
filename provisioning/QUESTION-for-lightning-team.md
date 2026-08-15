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

## The one narrow thing still fiddly (deploy-time credential wiring)

Getting the project-linked credential **into the deployed workflow snapshot** so
runs use it. Two observations from live testing:
- `openfn deploy` with `credential: <owner>-<name>` (the documented hyphenated
  reference, owner = `admin@bahmni.local`, name = `openmrs-prov`) still reports
  `Could not find a credential with name: admin@bahmni.local-openmrs-prov` even
  though the provision endpoint returns that credential with that exact owner+name
  and it is project-linked.
- Runs execute against a workflow **snapshot**; wiring `project_credential_id` on
  the live job (via rpc) does not affect runs — the snapshot's job shows
  `credential: NIL`. So the wiring must happen at deploy/provision time.

**Precise question:** what is the supported way to wire a project-linked
credential to a job so that a deployed snapshot (and its runs) uses it? Is it the
credential-map, a specific `deploy` invocation, or a `project_credential_id` field
in the `/api/provision` job payload? (We got the job wired on the live workflow
but not into the run snapshot.)

## Bottom line

The big blocker is gone: credentials can be created + linked headlessly, verified
live. What remains is a narrow deploy/snapshot credential-wiring detail — likely a
CLI/credential-map usage question, not a Lightning capability gap.
