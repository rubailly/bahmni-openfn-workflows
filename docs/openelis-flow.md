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
