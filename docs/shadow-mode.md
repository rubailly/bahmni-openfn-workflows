# Shadow-mode comparison

The first experiment writes nothing. It runs beside `odoo-connect` and records
what it *would* have sent, so the two can be diffed.

## Setup

1. Stock Bahmni with the `odoo` profile enabled (so `odoo-connect` runs as normal).
2. The `openfn` profile enabled alongside it.
3. The bridge pointed at the same OpenMRS feed `odoo-connect` consumes.

## What to measure

| Question | How |
|---|---|
| Same events seen? | Count entries processed by each side over a fixed window |
| Same payload produced? | Diff the logged `proposed` object against the Odoo record `odoo-connect` wrote |
| Failure visibility | Inject a malformed event; time how long it takes to find the payload, fix the mapping, and replay on each side |
| Cost of a new destination | Time how long it takes to add a second destination on each side |

The last row is the one that matters. The first three establish that the OpenFn
side is not simply broken; only the fourth speaks to the actual claim.

## Success and failure

* **Success:** payloads match, and adding a destination is materially cheaper.
* **Failure:** payloads match, and adding a destination is about the same
  effort. In that case the layer is not worth having, and this should be
  written up and archived rather than quietly continued.
