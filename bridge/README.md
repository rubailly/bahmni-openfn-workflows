# Bridge: not needed

An earlier version of this plan assumed a separate sidecar service was required
to read the OpenMRS Atom feed and POST events into Lightning. **It is not.**

OpenFn cron triggers carry state forward:

> Every time a cron-triggered workflow is run it will start with the final
> output of the last successful run. This allows users to build workflows that
> make use of a "cursor" that tracks what happened last time the workflow ran.
>
> — [OpenFn triggers documentation](https://docs.openfn.org/documentation/build/triggers)

That is exactly what a feed consumer needs. A cron-triggered workflow can read
the cursor from its incoming state, fetch the feed over HTTP, process whatever
is new, and return the updated cursor as its final state. No extra container,
no extra codebase, no extra image to maintain.

If run-state proves too fragile for the cursor (for example if a failed run
should not advance it), [Collections](https://docs.openfn.org/documentation/build/collections)
provides explicit key-value storage that persists across runs.

## Why this matters beyond convenience

The claim being tested is that a low-code layer can replace compiled sync
services. Adding a bespoke Java or Node sidecar to make that work would have
undercut the claim. Doing the whole thing as a workflow is the honest version
of the experiment, and it is a materially smaller piece of work.

## What the legacy consumer actually reads

From
[`erp-atomfeed.properties`](https://github.com/Bahmni/openerp-atomfeed-service/blob/master/openerp-atomfeed-service/src/main/resources/erp-atomfeed.properties)
in `openerp-atomfeed-service`:

| Property | Feed | Purpose |
|---|---|---|
| `customer.feed.generator.uri` | `/openmrs/ws/atomfeed/patient/recent` | Patient to Odoo customer |
| `saleorder.feed.generator.uri` | `/openmrs/ws/atomfeed/encounter/recent` | Encounter to Odoo sale order |
| `drug.feed.generator.uri` | `/openmrs/ws/atomfeed/drug/recent` | Drug catalogue |
| `lab.feed.generator.uri` | `/openmrs/ws/atomfeed/lab/recent` | Lab |
| `saleable.feed.generator.uri` | `/openmrs/ws/atomfeed/saleable/recent` | Saleable items |
| `referencedata.feed.generator.uri` | `/reference-data/ws/feed/recent` | Reference data |
| `openelis.saleorder.feed.generator.uri` | `/openelis/ws/feed/patient/recent` | OpenELIS patient |

It also calls back into OpenMRS REST for payloads:
`/openmrs/ws/rest/v1/bahmnicore/drugOrders` and `/openmrs/ws/rest/v1/order`.

**Seven feeds is the scope of full parity.** Phase 1 targets the first one
only. See [../docs/cutover-test.md](../docs/cutover-test.md).

## Cursor independence

`odoo-connect` persists its feed markers in **Odoo's own Postgres database**
(`jdbc.url=jdbc:postgresql://localhost/odoo`, `update.atomfeed.marker`). An
OpenFn workflow keeping its cursor in run state or Collections is therefore
completely independent of it. The two consumers cannot interfere with each
other's position, which is what makes a clean baseline-then-cutover comparison
possible.

## Open questions to resolve first

1. **Atom feeds are XML.** OpenFn adaptors are JSON-oriented. Confirm how to
   parse the feed response before designing around it; this is the first real
   technical unknown.
2. Does an entry carry the payload inline, or only a link that must be fetched
   separately? The workflow skeleton currently assumes a link.
3. Paging: `chunking.strategy=number` in the legacy config implies `/recent`
   plus numbered pages. Confirm how to walk backwards on first run, and
   whether the experiment should start from `/recent` only.
