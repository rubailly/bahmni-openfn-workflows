# Workflow visible on the enhanced adaptors — and how to run it

## VISIBLE: yes (deployed)

The workflow **"Patient sync (via adaptors)"** is deployed to the local Lightning
(project `bahmni-openfn`) and uses the enhanced adaptors:
- **Read OpenMRS feed and patient** → `@openfn/language-openmrs@5.4.2` (`getFeed` + `get`)
- **Write to Odoo via process_event** → `@openfn/language-odoo@2.2.2` (`callMethod`)

Open Lightning (`http://localhost:4000`, `admin@bahmni.local` / `BahmniOpenFn123!`)
→ project `bahmni-openfn` → workflow **Patient sync (via adaptors)**. Each job
shows the dedicated adaptor and the `getFeed`/`callMethod` code. The patched
adaptors are installed in the ws-worker's repo, so the functions resolve.

## RUNNING: create the two credentials in the UI (the normal path)

Everything runs EXCEPT credential resolution, and the cause is instructive:
Lightning v2.17.1 stores credential bodies **per project environment**
(a `credential_bodies` row named for the env, default `main`). Credentials I
created **programmatically** via `POST /api/credentials` did **not** get a valid
`main` environment body, so the run fails with
`CredentialLoadError: environment mismatch`.

**This is the headless-programmatic path being immature, not OpenFn credentials
being hard.** The UI produces a correct credential. To run:

1. In Lightning → **Credentials** → **New credential**:
   - **openmrs-adaptor** (raw or openmrs type):
     `instanceUrl = http://openmrs:8080/openmrs`, `username = admin`,
     `password = Admin123`.
   - **odoo-adaptor** (raw or odoo type):
     `baseUrl = http://odoo:8069`, `database = odoo`, `username = emrsync`,
     `password = <ODOO_ATOMFEED_PASSWORD>`.
   - Grant both to the `bahmni-openfn` project.
2. Open the workflow, click each job, and select its credential
   (read → openmrs-adaptor, write → odoo-adaptor).
3. Create a patient in Bahmni, then Run the workflow (or wait for the cron).

## What this confirms

The earlier hypothesis holds: **OpenFn credential management is easy in the
normal (UI) flow; our friction was entirely the fully-headless-programmatic
path** (raw creds via API, missing the v2.17.1 environment body, plus the
deploy/snapshot ordering). The workflow logic, the enhanced adaptors, and the
worker are all ready — only credential *creation* needs the UI (or the
correct programmatic sequence, which is the open provisioning question).
