# Runnable jobs

Real OpenFn jobs, runnable with the [OpenFn CLI](https://www.npmjs.com/package/@openfn/cli).

```bash
npm install -g @openfn/cli
cp state.example.json state.json   # fill in your Bahmni host + atomfeed creds
openfn customer.js -a http -s state.json -o out.json --log info
```

## customer.js — patient feed → Odoo customer `vals`

Reads the OpenMRS patient Atom feed, parses it, fetches the newest patient
record, and produces the `create.customer` `vals` payload that Bahmni's Odoo
`api.event.worker.process_event` consumes.

**Verified against a live Bahmni instance:** the `ref`, `uuid` and `name` it
produces match exactly the `res.partner` that the existing `odoo-connect`
service created for the same patient. This is the Phase 0 baseline comparison
(see ../docs/cutover-test.md), passing on real data.

Currently stops at building `vals` (dry run). The next step is the write:
`callMethod('api.event.worker', 'process_event', [$.vals])` via the Odoo
adaptor (see ../docs/decisions.md, D-2).

### Implementation notes discovered while building this

- `state.data` from the http adaptor's `get` is the **raw Atom XML string**;
  parse it in an `fn()` block.
- The http adaptor duplicates an **inline query string** when `baseUrl` is set,
  so split `path?query` and pass `query` via the adaptor option.
- The job sandbox has **no `URLSearchParams`** (nor other Web APIs); parse query
  strings manually.
- Feeds need **no auth**; content endpoints (`/openmrs/ws/rest/v1/...`) require
  it. Configure `username`/`password` (basic) on the adaptor, not a `headers`
  block, which the adaptor ignores for auth.

## customer-read.js + customer-write.js — full cutover (VERIFIED)

Two steps, mirroring how OpenFn/Lightning models multi-system flows (each system
is its own step with its own credential):

1. **customer-read.js** (OpenMRS config) — feed → patient → `vals`.
2. **customer-write.js** (Odoo config) — `process_event(vals)` via Odoo JSON-RPC.

**Verified on the local stack (odoo-connect stopped):** OpenFn created the Odoo
`res.partner` for a new patient, and the result matches field-for-field what
`odoo-connect` produced for an equivalent patient (ref, name, uuid,
customer_rank). This is the Phase 2 cutover, passing.

### Adaptor/API facts found while wiring the write
- `post(path, data, options)` — the request body is the **second positional
  arg**, not `{ body }`. `post(url, { body })` sends `{ body: {...} }`.
- language-http **blocks cross-origin** requests relative to `configuration.baseUrl`
  ("Target origin does not match baseUrl origin"). Reading OpenMRS and writing
  Odoo must be **separate steps with separate configs** — which is the correct
  Lightning pattern anyway.
- The write uses Odoo's `/jsonrpc` `execute_kw` (no session cookie needed;
  creds in the payload). The proposed `callMethod` odoo-adaptor function wraps
  exactly this call more cleanly.

## catalogue-transform.js — product flows (VERIFIED)

Covers all 5 catalogue categories (drug, lab test, lab panel, radiology,
saleable) via two Odoo service paths, both verified end-to-end with
`process_event` on the local stack:
- **drug** -> `drug.data.service`: product upserted, matched by uuid.
- **lab test** -> `reference.data.service` (shared by panel/radiology/saleable):
  product upserted with the right category ("All / Services / Lab / Test").

Both were idempotent updates of existing products (odoo-connect had synced them),
i.e. same upsert-on-uuid behaviour as odoo-connect. Reference-data payloads use
`id`/`isActive` field names (mapped to `uuid`/`is_active` in the transform);
drug payloads use `uuid`/`shortName`/`genericName`/`dosageForm`.

## customer-full-transform.js — full customer parity (VERIFIED)

Extends the customer flow to full field coverage, all verified via
`process_event` on the local stack:
- **phone** (from the `phoneNumber` person attribute -> `primaryContact`)
- **email** (from the `email` attribute)
- **res.partner.attributes** rows (one per person attribute)
- **address** (`preferredAddress` passed through -> `address.mapping.service`):
  `street` and `zip` populated; `city`/`state`/`country` are **config-gated**
  by the OpenMRS-to-Odoo address field mapping (same prerequisite odoo-connect
  has, not an OpenFn gap).
- **update in place**: re-syncing a changed patient updates the same partner
  (upsert on `ref`); partner count stays 1, no duplicate.

Person attributes come through as `person.attributes[].{attributeType.display,
value}`; the transform flattens them to `{name: value}` and derives
`primaryContact` from `phoneNumber`.

## feed catch-up (VERIFIED) — feed-cursor.js / feed-catchup-job.js

Robust cursor with **page catch-up**, so a workflow that falls behind never
skips events. Cursor = `{ pagePath, entryId }`, carried across cron runs.

- Reads **one page per run**; advances via `rel="next-archive"` when a newer
  page exists, else pins to the page's canonical `via` url. Catch-up happens
  over successive runs (bounded work each run).
- **Verified against the real paged feed:** starting mid-page-106, it walked
  106 → 107 → 108(head), processing all 12 entries in order, no skips. Edge
  cases tested: first run (prime), stale cursor not on page (reprocess-safe, not
  skip), steady state (nothing new).
- `feed-cursor.js` is the tested reference (CommonJS + a node test).
  `feed-catchup-job.js` is the inline OpenFn-job form (jobs can't `require`).
- First-run behaviour is flow-dependent: patient/encounter **prime** (process
  nothing, pin cursor); catalogue processes all on first run (matches
  odoo-connect's initial catalogue sync). Toggle `PRIME` in the job.
