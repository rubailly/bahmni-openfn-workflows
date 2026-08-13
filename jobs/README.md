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
