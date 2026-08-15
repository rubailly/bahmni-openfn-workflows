# Workflow visible on the enhanced adaptors — and it RUNS

## RUNNING: yes — verified end to end (2026-08-15)

The workflow **"Patient sync (via adaptors)"** ran to `status: success` in the
local Lightning, using **both** enhanced adaptors, and wrote a real customer to
Odoo. Successful-run log (run `d797505c`):

```
Starting step Read OpenMRS feed and patient   → @openfn/language-openmrs 5.4.2
  getFeed(patient): 2 entries                  ← enhanced getFeed (reads Atom feed)
  get() patient details (ops 2-4)
Starting step Write to Odoo via process_event → @openfn/language-odoo 2.2.2
  Calling api.event.worker.process_event...    ← enhanced callMethod (execute_kw)
  process_event: "The customer have been successfully created / updated."
Run complete with status: success
```

Independently verified over a separate XML-RPC connection: the most recently
written `res.partner` customer is `ref=ADPT164347 | Adaptor Flow`, write_date
matching the run. The full OpenMRS-feed → transform → Odoo-process_event loop
works on the dedicated, enhanced adaptors (no http fallback).

### What it took to make it run (all in the ws-worker repo, `node_modules/@openfn`)

The enhanced functions existed only in the adaptors' CJS build; the worker loads
the **ESM** `dist/index.js` and the compiler's auto-import reads the **`.d.ts`
types**. So for each adaptor we had to make the function visible in three places:

1. **`dist/index.js` (ESM)** — inject the function body + add it to the `export {}`
   block (`getFeed` reuses `request`/`cleanPath`/`expandReferences`/
   `composeNextState2`; `callMethod` reuses `odooConn`/`expandReferences`/
   `composeNextState`).
2. **`types/Adaptor.d.ts`** — declare the export, or the compiler's auto-import
   won't emit an `import { getFeed }` and the job crashes with
   `ReferenceError: getFeed is not defined` even though the runtime has it.
3. **`ast.json`** — add to `operations` (docs/metadata; belt-and-suspenders).
4. **odoo transitive deps** — copy `xmlrpc` + `xmlbuilder` (odoo-await needs them)
   into the worker repo `node_modules`, else `ImportError: Cannot find module
   'xmlrpc'`.

Restart the worker after patching so it re-reads the adaptor metadata.

**Lesson for the real contribution:** none of this is needed once the adaptors
are built and published properly — a real `npm run build` emits ESM + `.d.ts` +
`ast.json` consistently and declares deps. The manual three-place patch is only
because we hand-edited a published build in place. The upstream PRs (odoo
`callMethod`, openmrs `getFeed`) are the clean path.

## Credentials: solved via the UI (the normal path)

The earlier `CredentialLoadError: environment mismatch` was the fully-headless
path: Lightning v2.17.1 stores credential bodies **per project environment**
(`credential_bodies` row, default env `main`), and `POST /api/credentials`
didn't populate a valid `main` body. Creating the two credentials in the **UI**
(which fills the `main` environment body) resolved it immediately — the run above
used UI-created `openmrs-adaptor` + `odoo-adaptor` credentials. Confirmed:
OpenFn credential management is easy in the normal flow; the friction was only
the headless-programmatic body creation.

## VISIBLE: yes (deployed)

The workflow **"Patient sync (via adaptors)"** is deployed to the local Lightning
(project `bahmni-openfn`) and uses the enhanced adaptors:
- **Read OpenMRS feed and patient** → `@openfn/language-openmrs@5.4.2` (`getFeed` + `get`)
- **Write to Odoo via process_event** → `@openfn/language-odoo@2.2.2` (`callMethod`)

Open Lightning (`http://localhost:4000`, `admin@bahmni.local` / `BahmniOpenFn123!`)
→ project `bahmni-openfn` → workflow **Patient sync (via adaptors)**. Each job
shows the dedicated adaptor and the `getFeed`/`callMethod` code. The patched
adaptors are installed in the ws-worker's repo, so the functions resolve.

## How to reproduce the credentials step (the normal path)

This is what unblocked the run above. Lightning v2.17.1 stores credential bodies
**per project environment**
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
