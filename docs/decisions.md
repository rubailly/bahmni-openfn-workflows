# Decisions

## D-1: OpenFn calls process_event; it never writes Odoo models directly

The Bahmni Odoo modules (`bahmni_api_feed`, `restful_api`) expose a single
entry point, `api.event.worker.process_event(vals)`, that holds all the
business logic and idempotency (customer upsert on `ref`, draft-order
accumulation, order-type/shop/warehouse resolution). OpenFn reuses it rather
than reimplementing it. Writing `res.partner` / `sale.order` directly is
prohibited because it bypasses that logic and reintroduces double-billing.

See [odoo-side-architecture.md](odoo-side-architecture.md).

## D-2: Write path is `execute_kw` -> process_event, via a new adaptor function

Two ways to reach `process_event`:

- **http adaptor** POSTing to `/api/bahmni-*` (works today, but those routes are
  `auth="user"` and need Odoo web-session handling).
- **Odoo adaptor + a new `callMethod`** calling `execute_kw('api.event.worker',
  'process_event', [vals])`, reusing the adaptor's existing XML-RPC auth. This
  is the same path the original Java service used.

Plan: prototype with the http adaptor (no upstream dependency), and contribute
`callMethod` upstream as the clean long-term form.

### The `callMethod` contribution

`@openfn/language-odoo` exposes only CRUD helpers, each a preset call to
odoo-await's `execute_kw`. Custom model methods are unreachable. `callMethod`
surfaces `execute_kw` generically - useful to every Odoo user, not just Bahmni,
which is why it belongs upstream rather than in a fork.

Prepared as a patch in `../adaptors-odoo-patch` (function + tests + changeset +
README). Not yet forked/pushed.

## Verify before relying on D-2

- Model name on the target instance: old Java used `atom.event.worker`, these
  modules use `api.event.worker`. Confirm with
  `searchRead('ir.model', [['model','like','event.worker']])`.
