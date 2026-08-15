# Finding: OpenFn synced a real lab order that odoo-connect could not (Odoo 16)

Date: 2026-08-15. Verified on the local stack against a **real Bahmni-EMR-created
encounter** (patient ABC200001, a Complete Blood Count lab order placed through
the Bahmni clinical UI, not via API).

## Result

| | odoo-connect | OpenFn |
|---|---|---|
| Patient → partner | ✅ created | ✅ (create.customer) |
| Encounter → sale order | ❌ **fails** | ✅ **S00004 created**, line matched to the CBC product by uuid |

The OpenFn transform read the real encounter correctly (Lab Order line, and
`visitType: "OPD"` from the visit's "Visit Status" attribute) and
`process_event` created the sale order. odoo-connect, running against the same
encounter on the same stack, produced no sale order and logged NPEs continuously.

## Why odoo-connect fails here

Two chained failures on the encounter event:

1. **Timing race.** odoo-connect runs the patient feed and the encounter feed as
   independent jobs with no ordering guarantee. The encounter event was processed
   **before** the patient event created the partner, so `process_event` returned
   `417 Expectation Failed: Patient Id not found in Odoo`, and the event was
   marked failed.
2. **NPE on retry.** When odoo-connect retries the failed event (the partner now
   exists), `OpenERPSaleOrderEventWorker` throws
   `NullPointerException: String.startsWith(...) because value is null` instead of
   recovering. So it never succeeds.

This matches the KAH observation (`sale.order = 0` despite orders): on **both**
stacks tested, odoo-connect produces zero sale orders. Combined with the earlier
`ir.values` crash on dispensed orders (removed in Odoo 13), the Bahmni Odoo
integration has real **Odoo-16 compatibility problems** on the sale-order path.

## Why OpenFn succeeds

The OpenFn flow **sequences** the work: sync the customer first (partner exists),
then the sale order, calling `process_event` directly. This sidesteps the async
race that breaks odoo-connect. It reuses the same Odoo business logic
(`process_event`), so it is not bypassing anything — it just drives it in a safe
order.

## Honest caveats

- This is on two dev/test stacks (KAH + local), both Odoo 16. A production Bahmni
  with a different Odoo version or a tuned odoo-connect might behave differently;
  the odoo-connect NPE root field is not fully diagnosed.
- Consequence for the parity harness: the **sale-order flow cannot be diffed
  against odoo-connect**, because odoo-connect produces no baseline here. The
  positive result stands on its own: OpenFn synced the order end to end.
- The `ir.values` (dispensed) and this NPE are worth **reporting upstream** to
  Bahmni regardless of the OpenFn work.
