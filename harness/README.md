# Parity harness

Automated proof that OpenFn produces the **same Odoo state as odoo-connect** for
the same clinical actions. Turns case-by-case checking into a re-runnable report.

## Engine — `parity.py`
- `snapshot <odoo_url> <db> <uid> <pw> <ref> <out.json>` — captures the tracked
  Odoo models (`res.partner` incl. attribute rows, `product.product`) for a given
  ref/prefix, normalised (volatile fields excluded).
- `diff <a.json> <b.json>` — field-level diff; exit 0 = parity, 1 = differences.

## Orchestrator — `run-customer-parity.sh`
For a unique ref per run (`STAMP`):
1. create the patient via OpenMRS REST;
2. **[A]** odoo-connect ON → sync → snapshot;
3. reset (delete the partner, stop odoo-connect);
4. **[B]** OpenFn: fetch patient → `customer-full-transform.js` → `process_event` → snapshot;
5. diff A vs B → report.

Run: `STACK=<bahmni-standard dir> STAMP=$(date +%H%M%S) ./run-customer-parity.sh`

## Result & what it already caught

Customer flow: **PARITY ✓** (ref, name, email, address, attribute rows identical).

The harness immediately found a real divergence my manual checks missed: the
transform set `phone` from `primaryContact`, but **odoo-connect never sends
`primaryContact`** (it only sends `attributes`, so phoneNumber lands as a
`res.partner.attributes` row, not the `phone` field). Removing `primaryContact`
from the transform made the flows identical. This is exactly the harness's job:
surface where "looks the same" isn't.

## Growing the battery (next)
- catalogue flow (drug/lab → product): same pattern, key by uuid.
- encounter/order flows: needs scripted encounters (visit + orders) via REST —
  the harder actions; sale.order + sale.order.line added to the tracked models.

## Sale-order flow — harness built, blocked on encounter fidelity

`run-saleorder-parity.sh` scripts the full sale-order comparison (create patient
+ encounter with a lab order via `bahmnicore/bahmniencounter`; sync via
odoo-connect [A] vs OpenFn [B]; diff `sale.order` + `sale.order.line`).

**Encounter creation via REST now works** (previously the recurring blocker):
POST `bahmnicore/bahmniencounter` with `patientUuid`, `encounterTypeUuid`,
`visitTypeUuid`, `locationUuid`, `providers`, and `orders[{concept, orderTypeUuid}]`
creates the visit+encounter+order and it lands on the encounter feed.

**But the comparison is blocked because odoo-connect (baseline A) itself fails**
on a REST-created encounter, with two errors:
1. `Patient Id not found in Odoo` (417) — timing: the encounter event is
   processed before the patient event syncs the partner. odoo-connect retries,
   but the retry hits (2).
2. `NullPointerException: String.startsWith(...) because value is null` in
   `OpenERPSaleOrderEventWorker` — a field the Java worker expects is null on a
   REST-created encounter. A Bahmni-EMR-created encounter carries it (most likely
   the visit's "Visit Status" attribute or a careSetting) but our minimal REST
   POST does not.

**Developer handoff:** create the encounter the way Bahmni's EMR does (set the
visit "Visit Status" attribute; use the emrapi/consultation save path), or
diagnose the NPE field, so odoo-connect produces a sale order to diff against.
The OpenFn side of this flow is already proven (transform + write verified in
Phase 2); what's missing is a clean odoo-connect baseline for the automated diff.
