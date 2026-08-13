# Event bridge (design only — no implementation yet)

Something has to notice an OpenMRS event and POST it to a Lightning webhook.
This directory holds the design for that component. **No code exists here yet.**

## Option A: poll the existing Atom feed (simplest)

A small service that reads the Atom feed OpenMRS already exposes, tracks its own
cursor, and POSTs each entry to a Lightning webhook URL.

* Nothing in Bahmni changes. Works against a stock install.
* Reuses feeds that are already published and already consumed by
  `odoo-connect`, so shadow-mode comparison is apples-to-apples.
* Adds a second consumer of the same feed. Confirm that the feed's cursor
  semantics and retention tolerate this before relying on it.
* Latency is bounded by the poll interval.

Existing prior art to read first: [openerp-atomfeed-service](https://github.com/Bahmni/openerp-atomfeed-service).

## Option B: forward from openmrs-eip (preferred, if it proves out)

Add a Camel route to an existing [openmrs-eip](https://github.com/openmrs/openmrs-eip)
deployment that forwards its Debezium-derived events to the Lightning webhook.

* Reuses a proven CDC mechanism instead of building a second one.
* Genuinely event-driven; no polling.
* Collaboration with existing work rather than a parallel implementation.
* Requires an openmrs-eip deployment, so it is not a stock-Bahmni story.
* Events are row-level, so domain meaning must be reconstructed downstream.

**Option B is the better long-term design.** Option A exists only because it can
be stood up against an unmodified Bahmni for a first comparison.

## Explicitly rejected: an OpenMRS module

Registering a Spring `@EventListener` inside an OMOD would give low-latency
domain-level events, but it means building and deploying a module into OpenMRS
and tracking Bahmni core versions indefinitely. Given openmrs-eip exists, this
is almost certainly unnecessary.

## Open questions before writing any code

1. What exactly does an Atom feed entry contain, and what has to be fetched
   separately? The `project.yaml` skeleton currently *assumes* a shape.
2. What are the feed's retention and cursor semantics with two independent
   consumers?
3. How does `odoo-connect` handle failures and replays today? Shadow-mode
   comparison is only meaningful if both sides see the same event set.
