# For the Bahmni community: two Odoo-16 issues in the Odoo sync path

While prototyping an alternative OpenMRS→Odoo integration, we ran the standard
`openerp-atomfeed-service` (odoo-connect) and the `bahmni-odoo-modules` against
Odoo 16 and hit two reproducible failures on the **sale-order** path. Both are
independent of our prototype — they affect odoo-connect directly — so we're
surfacing them regardless of where the OpenFn exploration goes.

**Environment:** Bahmni Docker (`bahmni-standard`), Odoo 16
(`bahmni/odoo-16:1.0.0`), `bahmni/odoo-connect:1.0.0`, on two independent stacks
(a dev server and a fresh local install). Not yet reproduced on other Odoo
versions.

---

## Issue 1 — `ir.values` on dispensed orders (removed in Odoo 13)

**Symptom:** syncing an encounter order marked *dispensed* fails; `process_event`
returns `'NoneType' object has no attribute ...` / an `ir.values` error and no
sale order is created.

**Cause:** `bahmni_api_feed/models/order_save_service.py` (~line 180) calls
`self.env['ir.values'].search([('model','=','sale.config.settings'), ...])`.
The `ir.values` model was **removed in Odoo 13** (replaced by `ir.default` /
`ir.config_parameter`), and `sale.config.settings` was renamed to
`res.config.settings`. So the dispensed-order branch cannot run on Odoo 13+.

**Impact:** dispensed orders never reach Odoo on Odoo 16.

---

## Issue 2 — sale orders not created: timing race + NPE on retry

**Symptom:** with a real lab order placed through the Bahmni EMR, the patient
syncs to a `res.partner` but **no `sale.order` is ever created**. (`sale.order`
count stays 0 even though partners and the ordered products exist.)

**Sequence observed in the odoo-connect logs:**
1. The **encounter** feed event is processed **before** the **patient** feed
   event has created the partner, so `process_event` returns
   `417 Expectation Failed: Patient Id not found in Odoo` and the event is marked
   failed. (The patient and encounter feeds are consumed by independent jobs
   with no ordering guarantee.)
2. On **retry** of the failed event (the partner now exists),
   `OpenERPSaleOrderEventWorker.process` throws
   `java.lang.NullPointerException: Cannot invoke "String.startsWith(String)"
   because "value" is null` — so the retry never succeeds either.

**Impact:** on both stacks tested, odoo-connect produced **zero** sale orders.

**Notes / open questions for the community:**
- Is this seen in production Bahmni, or does a specific config / Odoo version
  avoid it? (e.g. is there deployment guidance that guarantees patient-before-
  encounter ordering?)
- We have not fully isolated which field is `null` in the `startsWith` call.
- The sale-order path also depends on Odoo master data that is empty by default
  (`order.type`, `sale.shop`, `order.type.shop.map`, and product↔concept uuid
  matches). That's expected implementation config, but combined with the above,
  a default stack produces no sale orders at all.

---

## Issue 3 — OpenELIS→Odoo sale-order worker omits Odoo-required fields

**Symptom:** the OpenELIS→Odoo flow (`OpenElisSaleOrderEventWorker`) produces no
sale order on Odoo 16; `process_event` fails with `NoneType.lower()` or KeyErrors
(`orderId`, `productName`, `conceptName`, `quantity`, ...).

**Cause:** `OpenElisLabOrder.addNewOrder` sets only `encounterId`, `voided`,
`productId` on each order, but `bahmni_api_feed`'s `order_save_service` requires
`orderId`, `productName`, `conceptName`, `quantity`, `quantityUnits`,
`previousOrderId`, an order `type` (looked up as an `order.type`), and
`visitType` (for `care_setting`, else `NoneType.lower()`). The worker omits all
of these, so no line is created.

**Impact:** OpenELIS-originated lab orders are not billed in Odoo on this
module/Odoo-16 combination.

---

## What we can share

We're happy to provide full logs, the exact REST calls, and the two stacks'
configs. If these are already known/fixed on a newer image, pointers welcome —
we'd rather build on a working baseline than around a broken one.
