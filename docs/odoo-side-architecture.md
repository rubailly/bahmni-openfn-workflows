# Odoo-side architecture — what the sync actually is

Studied from `bahmni-odoo-modules` (the Odoo modules) alongside
`openerp-atomfeed-service` (the Java service). This corrects a wrong assumption
that shaped the earlier plan.

## The integration is thin-client, thick-Odoo

The earlier plan assumed the Java `odoo-connect` service contains the mapping
logic and writes Odoo records directly, so replacing it meant reimplementing
that logic in OpenFn. **That is not how it works.**

```
OpenMRS feed ──▶ odoo-connect (Java) ──▶  Odoo: api.event.worker.process_event(vals)
                 reads feed                 └─ ALL business logic lives here
                 fetches payload
                 transforms to `vals`
                 calls process_event
```

`OpenERPSaleOrderEventWorker.java` line 84 calls `process_event` on the Odoo
model (via XML-RPC on older Odoo, via REST `/api/bahmni-*` on Odoo 16 through
`OdooRESTClient`). The Java service's entire job is **read → fetch → transform →
dispatch**. It writes nothing directly.

The real logic lives in the Odoo modules:

| Concern | Where |
|---|---|
| Dispatch by category | `bahmni_api_feed/models/api_event_worker.py` → `process_event` |
| Customer upsert | same file, `_create_or_update_customer` |
| Sale order creation (556 lines) | `bahmni_api_feed/models/order_save_service.py` |
| Drug / reference data | `drug_data_service.py`, `reference_data_service.py` |
| REST endpoints | `restful_api/models/api_data_feed.py` |
| sale.order / partner / product field customisations | `bahmni_sale`, `bahmni_product` |

## The single entry point

Everything funnels through one method that switches on a `category` string
(`api_event_worker.py`):

| REST endpoint (`restful_api`) | category | Odoo handler |
|---|---|---|
| `/api/bahmni-customer` | `create.customer` | `_create_or_update_customer` |
| `/api/bahmni-saleorder` | `create.sale.order` | `order.save.service.create_orders` |
| `/api/bahmni-drug` | `create.drug` | `drug.data.service` |
| `/api/bahmni-lab-test` | `create.lab.test` | `reference.data.service` (Test) |
| `/api/bahmni-lab-panel` | `create.lab.panel` | `reference.data.service` (Panel) |
| `/api/bahmni-radiology-test` | `create.radiology.test` | `reference.data.service` (Radiology) |
| `/api/bahmni-service-sale` | `create.service.saleable` | `reference.data.service` (Others) |

All routes are `auth="user"`, `type="json"`. This is what the `emrsync` Odoo
user (uid 6 on the KAH instance) authenticates as.

## Consequence for the OpenFn design

**OpenFn should call `process_event` / the `/api/bahmni-*` endpoints, not write
Odoo records directly.** This is the difference between a small, safe project
and a large, risky one:

* The 556-line order logic — warehouse resolution, order-type→shop mapping,
  draft-order accumulation, dispensed vs non-dispensed handling — is **reused,
  untouched**. OpenFn never reimplements it.
* Idempotency is **handled in Odoo**, which resolves the double-billing worry
  from `feed-observations.md`. `create_orders` finds the customer's existing
  **draft** sale order and appends lines to it rather than creating duplicates
  (`order_save_service.py` ~line 123-171); the customer handler upserts on
  `ref`. OpenFn must therefore go *through* `process_event` and must **not**
  write `sale.order` directly, or it loses this dedup.

So OpenFn's real job is exactly the Java service's job, and no more: read the
OpenMRS feed, fetch the payload, **transform it into the `vals` shape**, and
POST it to the right endpoint with the right `category`.

## The actual spec: the `vals` contract

The mapping work is producing these shapes. This is what to pin down precisely
against live payloads.

**create.customer** (from `_get_customer_vals` + `_create_or_update_customer`):
```
ref              patient identifier   (search key for upsert)
name             display name
local_name       optional
uuid             patient uuid
primaryContact   -> written to phone
attributes{}     -> res.partner.attributes rows; attributes.email -> email
preferredAddress{} -> via address.mapping.service
```

**create.sale.order** (from `create_orders`):
```
customer_id          patient ref   (partner must already exist)
invoice_customer_id  payer ref
locationName         resolves shop + warehouse
encounter_id
orders { openERPOrders: [ { ...order, dispensed: 'true'|'false' } ] }
```

Reference-data categories (drug/lab/radiology/saleable) carry product-shaped
payloads; see `drug_data_service.py` and `reference_data_service.py`.

## Master data that MUST exist or orders fail silently-ish

`create_orders` resolves every order against configuration records. If these
are absent, sale-order creation fails or no-ops — which is the most likely
explanation for **`sale.order = 0` on the KAH instance despite synced orders**,
i.e. a configuration gap, not a sync bug:

* `order.type` records matching each order's type
* `order.type.shop.map` (order type → `sale.shop`, optionally per location)
* `order.picking.type.mapping` and `stock.warehouse` / `stock.picking.type`
* at least one `sale.shop`
* the **customer must be synced before the order** (order save searches
  `res.partner` by `ref`; no partner → no order)

Confirming these on KAH is now the top Phase 0 task, and it is an Odoo-config
question, not an OpenFn one.

## Revised workflow count

Because the Odoo side does the heavy lifting, the OpenFn footprint is small:

1. **Customer** — patient feed → `vals` → `/api/bahmni-customer`
2. **Sale order** — encounter feed → `vals` → `/api/bahmni-saleorder`
   (the only genuinely complex transform, `MapERPOrders` in Java is the
   reference)
3. **Catalogue** — drug/lab-test/lab-panel/radiology/saleable → one workflow
   branching on category → the matching `/api/bahmni-*` endpoint

Three workflows, not eight, and none of them reimplement Odoo business logic.
The risk concentrates entirely in the sale-order transform and the Odoo master
data, both of which are now identified.

## Still to verify

* Whether the KAH `odoo-connect` uses the REST path or XML-RPC (docker-compose
  set `IS_ODOO_16: true`, which implies REST). Either way the entry point is
  `process_event`.
* The exact `openERPOrders` element shape produced by `MapERPOrders.java` — that
  is the precise target for the sale-order transform.
* The reference-data `vals` shapes for the catalogue categories.
