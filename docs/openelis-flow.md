# Flow 8 — OpenELIS lab order → Odoo sale order

odoo-connect's 8th worker (`OpenElisSaleOrderEventWorker`) reads the OpenELIS
patient feed (`openelis/ws/feed/patient/recent`) and creates Odoo sale orders
for lab tests ordered in OpenELIS. It posts to the **same**
`process_event(create.sale.order)` with the same `orders.openERPOrders[]` shape
as the OpenMRS encounter flow — so the write path is already proven; only the
source feed and transform differ.

## Transform (`jobs/openelis-saleorder-transform.js`) — VERIFIED

`OpenElisLabOrder` → `create.sale.order` vals:
- `customer_id` = `patientIdentifier`
- `orders.id` = `accessionUuid`
- one `openERPOrder` per `testDetail`: `productId` = `panelUuid || testUuid`
  (panels collapse duplicate tests), matched to an Odoo product **by uuid**.

**Verified end to end:** transform → `process_event` → sale.order.line created,
product matched by uuid (`Stool for ova ...`), idempotency key
(`external_order_id`) = `accessionUuid-testUuid`.

## Finding: the Java reference omits many Odoo-required fields

`OpenElisLabOrder.addNewOrder` sets only `encounterId`, `voided`, `productId`.
But `order_save_service` **requires** (bracket access, KeyErrors otherwise):
`orderId`, `productName`, `conceptName`, `quantity`, `quantityUnits`,
`previousOrderId`, plus `type` (grouped/looked up as an `order.type`) and
`visitType` (for `care_setting`, or it crashes with `NoneType.lower()`).

So on this Odoo module / Odoo 16, the OpenELIS→Odoo flow would fail on nearly
every one of these. **OpenFn fills them in** (type="Lab Order", visitType="OPD",
quantity=1, a stable `accessionUuid-testUuid` orderId, and the uuid as a
placeholder name since `OpenElisTestDetail` carries no test name). This is a
third Odoo-16 gap in the Bahmni Odoo path (after `ir.values` on dispensed and
the OpenMRS sale-order NPE) — worth the community's attention.

## Not yet done: reading the live OpenELIS feed

The transform + write are proven against a constructed `OpenElisLabOrder`. Full
end-to-end needs **OpenELIS running** (the `openelis` profile) and a lab order on
its feed. That was deferred here for memory (the OpenELIS + its DB containers
strain a 15 GB box already running EMR+Odoo+OpenFn). Bringing OpenELIS up and
placing a lab order in its UI (or a fuller-RAM host) closes the last gap; the
OpenFn logic is ready. A real feed payload may also carry a test **name** to use
for `productName` instead of the uuid placeholder.

## OpenELIS brought up in the real stack (2026-08-15) — two OpenELIS-internal blockers

OpenELIS was started as part of the Bahmni stack (`openelis` profile, same
compose). It runs and consumes the OpenMRS feeds. But getting a real
patient-feed entry to flow through is blocked by **two OpenELIS-internal issues**
(not OpenFn, and not the Odoo side):

1. **OpenELIS patient sync gap.** OpenELIS creates lab samples from the OpenMRS
   encounter feed, but first needs the patient in its own DB (populated from the
   OpenMRS *patient* feed). For the test patient (ABC200001) sample creation
   fails: `LIMSRuntimeException: Patient with uuid '...' not found in ELIS`
   (`EncounterFeedProcessor.createSample`). So no sample → the OpenELIS patient
   feed has nothing for that patient. This is OpenELIS's own patient-feed sync,
   a race/config issue inside OpenELIS.

2. **OpenELIS feed auth.** `/openelis/ws/feed/patient/recent` returns `401` for
   the configured `atomfeed` credential (the user exists in `login_user`, but
   the stored password hash doesn't match the stack's `OPENELIS_ATOMFEED_PASSWORD`;
   custom OpenELIS hashing, no `WWW-Authenticate`). A stack credential/seed
   mismatch.

**Conclusion:** the flow-8 OpenFn transform + write are proven (above). The live
OpenELIS-feed read needs OpenELIS's own patient-sync and feed-auth resolved —
OpenELIS Bahmni-stack debugging, independent of the OpenFn work. Notably,
OpenELIS's sample-creation shows the *same* patient-before-dependent-event race
we saw break odoo-connect's sale orders.
