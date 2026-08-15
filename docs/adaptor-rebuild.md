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
| **OpenELIS read** | http (param auth) | **`language-openelis` + `getFeed`/`getResource`, typed cred** | VERIFIED (below). The adaptor did only Basic-auth HTTP against the OpenELIS-Global REST prefix; Bahmni needs `loginName`/`password` param auth on `/openelis/ws`. Added as our third contribution. |

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

## Principle: enhance the adaptor, don't fall back to http

When a dedicated adaptor is missing something we need, the right move is to
**add it to the adaptor** (a reusable contribution to OpenFn), not to drop to the
raw http adaptor. Two contributions now, both verified against live Bahmni:

| Adaptor | Function | Fills the gap | Branch |
|---|---|---|---|
| `language-odoo` | `callMethod(model, method, args)` | adaptor did only CRUD, couldn't call `process_event` | `rubailly/adaptors@odoo-callmethod` |
| `language-openmrs` | `getFeed(name, {page})` | adaptor's `get()` only hits `/ws/rest/v1`, couldn't read Atom feeds | `rubailly/adaptors@openmrs-getfeed` |
| `language-openelis` | `getFeed(name, {page})` + `getResource(path)` | adaptor used Basic auth against the OpenELIS-Global REST prefix; Bahmni needs `loginName`/`password` param auth on `/openelis/ws` | `rubailly/adaptors@openelis-bahmni` |

With all three, every flow uses dedicated adaptors + typed credentials end to end:
- OpenMRS feed → `language-openmrs.getFeed`
- OpenMRS content → `language-openmrs.get`
- OpenELIS feed + accession → `language-openelis.getFeed` / `getResource`
- Odoo write → `language-odoo.callMethod` → `process_event`

Each is generally useful (any OpenFn+OpenMRS integration wants feed reading; any
OpenFn+Odoo integration wants arbitrary method calls), which is why they belong
upstream rather than in our project.

## Verified: OpenELIS read on the enhanced adaptor

Reading the upstream `language-openelis` (v1.1.2) source showed **two** blockers
for a Bahmni-packaged OpenELIS, both because the adaptor targets **OpenELIS-Global**:
1. It authenticates with **HTTP Basic auth** (`makeBasicAuthHeader`); Bahmni's
   OpenELIS (a Struts `WebServiceAction`) reads `loginName`/`password` as
   **request params**.
2. It hardcodes the path prefix `/api/OpenELIS-Global/rest/`; Bahmni serves feeds
   and resources under `/openelis/ws/...`.

`getFeed(feedName, options)` and `getResource(path, options)` target that variant
(param auth via a `bahmniRequest` helper, Bahmni paths). Verified live against a
Bahmni OpenELIS and with unit tests (`enableMockClient`, the adaptors repo's
standard mock). The flow-8 workflow **"OpenELIS lab sync (via adaptors)"** ran to
`success` in Lightning: `getFeed('patient')` → `getResource(<accession>)` →
transform → `language-odoo.callMethod` → `process_event` created the sale order.

Since it targets the Bahmni variant (not OpenELIS-Global), whether it lands
upstream in `@openfn/language-openelis` or as Bahmni-specific config is a
maintainer call (OpenFn product / the OpenELIS-Bahmni maintainers).

## All three flows run live

With the three enhancements deployed to a local ws-worker, all three OpenMRS/
OpenELIS→Odoo flows **run end to end in the Lightning UI** on the dedicated
adaptors, no http fallback. See `ui-visible-and-run.md` for the run logs and the
one caveat (these run on hand-patched builds; the clean path is the three PRs).
