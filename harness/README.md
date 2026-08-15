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
