# Sale-order transform spec

The exact contract for `category: create.sale.order`, reverse-engineered from
`MapERPOrders.java` (the Java reference implementation). This is what the OpenFn
sale-order workflow must reproduce and POST to `/api/bahmni-saleorder`.

This is the one genuinely complex transform. The customer and catalogue
transforms are simple by comparison.

## The `vals` payload

```jsonc
{
  "category": "create.sale.order",
  "customer_id": "<encounter.patientId>",      // partner must already be synced
  "encounter_id": "<encounter.encounterUuid>",
  "locationName": "<encounter.locationName>",
  "orders": {
    "id": "<encounter.encounterUuid>",
    "openERPOrders": [ /* OpenERPOrder objects, see below */ ]
  }
  // feed_uri, last_read_entry_id, feed_uri_for_last_read_entry:
  //   feed bookkeeping in the Java service. OpenFn manages its own cursor,
  //   so these are almost certainly unnecessary - CONFIRM the Odoo side does
  //   not depend on them before dropping.
}
```

Serialisation caveat: the Java code sets `orders` to a *stringified* JSON blob
(`createParameter("orders", ...writeValueAsString..., "string")`), but the Odoo
side reads it as an object (`orders.get('openERPOrders')`). Over the JSON REST
endpoint, send `orders` as a **nested object**, not a string. Verify against a
real POST.

## OpenERPOrder element (field names are the serialised JSON keys)

```
orderId          order uuid
previousOrderId  previousOrderUuid
encounterId      encounter uuid
productId        drug uuid (drug orders) | concept uuid (lab/other)
productName      drug name | concept name
quantity         dosingInstructions.quantity (drugs) | 1 (lab/other)
quantityUnits    dosingInstructions.quantityUnits (drugs) | "Unit(s)"
action           NEW | REVISE | DISCONTINUE | ...
dispensed        "true" | "false"   (string, not bool)
type             orderType
visitId          encounter.visitUuid
visitType        from the VISIT payload (see below)
voided           bool
providerName     first provider's name
conceptName      order.conceptName
dateCreated      dateActivated (drugs) | dateCreated (lab/other)
locationName     (set on the order too in some paths)
description
```

## Transform rules — the actual logic

The order list is built from **two arrays** in the encounter payload, merged:

### A. `drugOrders[]`
1. **Skip** if `drugNonCoded != null` (free-text drugs are not billed).
2. **Skip** if billing-exempt (see callback below).
3. `quantity` = `dosingInstructions.quantity`; `dateCreated` = `dateActivated`.
4. **`dispensed`**: scan the encounter `observations[]` for an obs whose
   `orderUuid` matches this order and whose concept name is `Dispensed`; if its
   value is truthy, set `dispensed = "true"`.
5. **REVISE chaining (Odoo 16 only):** if `action == "REVISE"` and the previous
   order is not already in the batch, **fetch it** from
   `drugOrders/{previousOrderUuid}` and add it too.

### B. `orders[]` (lab, radiology, other)
1. **Skip** if billing-exempt.
2. `quantity` = `1`, `quantityUnits` = `"Unit(s)"`, `productId` = concept uuid.
3. **Dedup — keep latest action per product:** group by `productId`, keep only
   the entry with the newest `dateCreated`. This is why the same product ordered
   twice does not double-bill. `MapERPOrders.findLatestOrder`.

Note the two arrays are treated differently: drug orders are NOT deduped by
product the way lab orders are (drugs chain via REVISE instead).

## Extra fetches the workflow needs (beyond the encounter payload)

The transform is not a pure function of the encounter. It makes up to three
additional OpenMRS calls:

| Need | Source | When |
|---|---|---|
| `visitType` | the **visit** — attribute named `Visit Status` | every order |
| billing-exempt flag | order attribute API for each order uuid | every order, if a billing-exempt attribute name is configured |
| previous drug order | `drugOrders/{previousOrderUuid}` | drug orders with `action == REVISE` |

`visitType` alone means the workflow must fetch the **visit** in addition to the
encounter. Budget for these calls when sizing the cron interval.

## Billing-exempt callback

Controlled by a configured attribute name (`order.billingExempt.attributeName`,
`IS_BILLING_EXEMPT` in the sample config). For each order, GET the order's
attributes; if the attribute is present and true, **skip the order entirely**.
If the config name is blank, skip this check (nothing is exempt). Failures are
treated as non-exempt (fail open) so a lookup error does not drop billing.

## Fields that come from elsewhere, not the encounter order

* `providerName` — `encounter.providers[0].name`
* `visitType` — visit attribute, separate fetch
* `dispensed` — encounter observations, cross-referenced by order uuid
* `customer_id` — `encounter.patientId` (a Bahmni identifier, not the uuid)

## What this means for build order

1. **Customer workflow first.** Orders reference the customer by `ref`; the
   partner must exist. Also the simplest transform.
2. **Catalogue workflow.** Independent, low-risk, populates products.
3. **Sale-order workflow last.** It depends on 1 and 2 (customer must exist,
   products must exist for the order lines to resolve), and it carries all the
   complexity above plus the Odoo master-data prerequisites in
   `odoo-side-architecture.md`.

## Still to confirm against live POSTs

* Whether the Odoo side needs the `feed_uri` / `last_read_entry_id` bookkeeping
  fields, or ignores them.
* `orders` as nested object vs string over the REST endpoint.
* The exact visit endpoint and attribute shape for `Visit Status`.
* The order-attribute endpoint shape for the billing-exempt check.

## VERIFIED end-to-end on the local stack (2026-08-13)

Transform run against a real KAH encounter → 3 correct lines (Paracetamol
qty 10; CBC + Bands qty 1). Write via `process_event(create.sale.order)` on the
local Odoo → **sale order S00003 created** with an order line whose product was
matched by uuid. Full read→transform→write chain works.

### Prerequisites the sale-order write needs (all implementation-config)

These are empty on a default Bahmni Odoo (both KAH and a fresh local stack),
which is the definitive cause of `sale.order = 0`. They are identical
requirements for odoo-connect — not an OpenFn concern:

1. **`order.type`** records whose `name` matches each order's `type`
   (e.g. "Lab Order", "Drug Order").
2. **`sale.shop`** — requires `name`, `payment_default_id`, plus `warehouse_id`
   and `location_id` to be useful.
3. **`order.type.shop.map`** linking order type → shop (a row with no
   `location_name` acts as the default).
4. **Products matched by `product.product.uuid` = the order's `productId`**
   (concept uuid for lab, drug uuid for drugs). The catalogue feeds populate
   these uuids.

### `vals` fields that are mandatory or the create crashes/misbehaves

- **`visitType`** must be present, or `create_orders` throws
  `'NoneType' object has no attribute 'lower'` (care_setting derivation). The
  Java source is the visit's "Visit Status" attribute, so the workflow must
  fetch the **visit**, not only the encounter.
- **`quantityUnits`** must map to the product UOM via `syncable.units.mapping`,
  or the line quantity defaults to 0 (line still created). Another
  implementation-config item.

### Minimal seed used to prove the write (RPC)

```
order.type            {name: "Drug Order"}
sale.shop             {name, payment_default_id, warehouse_id, location_id}
order.type.shop.map   {order_type, shop_id}     # no location_name = default
```
