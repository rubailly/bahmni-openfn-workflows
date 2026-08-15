# Brief for OpenFn product (Brandon's team): Bahmni ↔ OpenFn integration

A status brief + one specific ask. This is an exploration of OpenFn as a
drop-in for Bahmni's `odoo-connect` (the OpenMRS→Odoo integration). It is an
individual initiative, not an OpenFn commitment — this brief is to get the
product team's read and unblock the one thing that needs Lightning expertise.

## What is proven (working code, run against a live Bahmni)

All via the OpenFn CLI against a full local Bahmni stack (OpenMRS + Odoo 16 +
OpenFn Lightning), reusing Bahmni's own Odoo entry point
(`api.event.worker.process_event`) so the Odoo-side business logic and
idempotency are reused, not reimplemented:

- **Customer flow** (patient → `res.partner`): full — identity, email,
  attributes, address, updates. **Automated parity diff vs odoo-connect: PARITY.**
- **Catalogue flows** (drug/lab/panel/radiology/saleable → products): all 5
  verified; drug is parity-green in the harness.
- **Sale-order flow** (encounter → `sale.order`): full `MapERPOrders` transform
  + edges (dispensed, visitType, REVISE, billing-exempt) + idempotency. OpenFn
  synced a **real EMR-placed lab order** to a sale order end to end.
- A small **parity harness** (snapshot + field-level diff + report) that turns
  "looks the same" into a re-runnable proof. It already caught and fixed a real
  divergence in our own customer transform.

## A finding worth the team's attention

On both stacks tested, **odoo-connect itself produces zero sale orders** on
Odoo 16 (a patient-before-encounter timing race, then an NPE on retry; plus an
`ir.values` crash on dispensed orders — `ir.values` was removed in Odoo 13).
OpenFn's sequenced flow (customer-then-order, direct `process_event`) avoids the
race and succeeds where odoo-connect fails. Details in
`for-bahmni-community.md`. This reframes "parity": for sale orders there may be
no working odoo-connect baseline to match.

## The one thing blocked on Lightning expertise

We want a **turnkey** install: enable the OpenFn profile and Lightning comes up
with the workflow deployed, credentials attached, and triggers enabled — no UI
clicks. We got: user+token creation, credential creation, project+cron deploy,
**cron fires and the worker executes**. We are blocked on the **headless
credential provisioning** path. Specific questions (full detail in
`provisioning/QUESTION-for-lightning-team.md`):

1. Supported way to link credentials to a project's jobs on a **first** deploy
   (chicken-and-egg: `openfn deploy` resolves job credentials only from
   project-linked credentials, but the project doesn't exist yet).
2. How a `raw` credential's `body` (baseUrl/auth) reaches a job as
   `state.configuration` at run time (we hit `UNEXPECTED_RELATIVE_URL`).
3. The workflow-**snapshot** model — is re-`deploy` the intended path for any
   change, and is there a first-boot sequence that creates creds + deploys them
   linked in one shot?
4. Is there an official **auto-provisioning** pattern for self-hosted Lightning
   in Docker we should follow instead of scripting `bin/lightning rpc`?

Also, two config gaps we had to fix in our Docker profile that may belong as
image defaults: Lightning doesn't run DB migrations on boot; and the ws-worker
can't connect unless `ORIGINS` is set (endpoint `check_origin` is `nil` → HTTP
500 on `/worker/websocket`).

## The ask

A short pointer to the supported headless-provisioning pattern (or confirmation
that scripting it is expected), and the team's read on whether this exploration
is worth carrying further. Everything is in `github.com/rubailly/bahmni-openfn-workflows`
and the two forks (`rubailly/bahmni-docker`, `rubailly/adaptors`).
