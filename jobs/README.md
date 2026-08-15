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
