# Rebuild on dedicated adaptors + typed credentials

Reassessment after noticing we used `language-http` + raw credentials where
dedicated adaptors exist. All three adaptors ship **typed credential schemas**
(the proper OpenFn credential-management path), not the `raw` schema we used.

## Per-flow verdict

| Flow | Was | Should be | Why |
|---|---|---|---|
| **Odoo write** | http → `/jsonrpc` → process_event, raw cred | **`language-odoo` + `callMethod` → process_event, typed cred** | VERIFIED (below). The adaptor's CRUD can't call `process_event`; `callMethod` (our PR) can, over XML-RPC, with the typed Odoo credential. |
| **OpenMRS content** (patient/encounter) | http, raw cred | `language-openmrs` `get()`, typed cred | Idiomatic REST + auth. |
| **OpenMRS atom feed** | http | **stays http** | The openmrs adaptor hardcodes `/ws/rest/v1/`; it cannot read `/openmrs/ws/atomfeed/...`. Feed polling is genuinely an http task. |
| **OpenELIS read** | http (param auth) | `language-openelis`, typed cred (verify it handles `loginName`/`password` param auth) | Typed cred; auth mechanism TBC. |

## Verified: idiomatic Odoo write

`language-odoo` (v2.2.2) + a **typed** credential
(`{baseUrl, database, username, password}`) + the `callMethod` function (our PR,
patched into the adaptor) called `api.event.worker.process_event(vals)` over
**XML-RPC** and created the `res.partner` (ref ADAPTOR-TEST-2). No http, no
`/jsonrpc`, no raw credential.

This is the strongest argument yet for landing the `callMethod` PR: it turns the
Odoo write from an http workaround into the idiomatic adaptor path with proper
credential management.

## On credentials being "hard"

Two things made our headless-provisioning harder than normal:
1. We used **raw** credentials, not the typed adaptor schemas Lightning's
   credential tooling is built around.
2. We deployed the workflow **before** creating the credentials.
Normal (UI) credential use is easy; our friction is the fully-headless first-boot
path plus these two self-inflicted choices. Rebuilding on typed adaptor
credentials is both more idiomatic and likely to smooth provisioning.

## Note (testing artifact)
Testing `callMethod` via the OpenFn CLI hit a compiler issue: it recognizes
adaptor exports from packaged metadata (ast.json / d.ts), so a locally-patched
export isn't auto-imported ("callMethod is not defined"). Calling the adaptor
directly via node works. Once the PR is merged + published, the CLI recognizes it.
