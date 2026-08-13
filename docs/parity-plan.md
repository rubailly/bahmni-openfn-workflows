# Parity plan: OpenFn as a drop-in replacement for odoo-connect

Goal: a fresh Bahmni install that selects the OpenFn option comes up with a
working OpenMRS to Odoo integration that does **everything odoo-connect does**,
with odoo-connect off, and the installer can be confident of it because it is
**automatically verified against odoo-connect**.

Status today (2026-08-13): proof of concept for 2 of 7 flows, run by hand. This
plan is the path from that to turnkey, verified parity. It is a multi-week
engineering effort and needs a developer.

---

## 1. Definition of parity (the acceptance test)

"Parity" is not a feeling; it is a passing test. We define it as:

> Given two identical Bahmni stacks, **A** (stock, odoo-connect on) and **B**
> (OpenFn profile, odoo-connect off), when the **same scripted battery of
> clinical actions** is applied to each, the resulting Odoo state is
> **equivalent** across every tracked model.

**Tracked Odoo models:** `res.partner`, `product.template` / `product.product`,
`sale.order`, `sale.order.line`.

**The action battery (minimum):**
1. Register a patient; update the patient.
2. Patient with an address and person attributes.
3. Visit + encounter with one lab order.
4. Encounter with several lab orders (dedup case).
5. Encounter with a drug order (quantity, dosing).
6. Drug order REVISE (previous-order chaining).
7. Order marked dispensed.
8. One item of each catalogue type (drug, lab test, lab panel, radiology,
   saleable).
9. Two orders added to one encounter across two events (idempotency / no
   double-bill).

**Equivalence** = a field-level diff (ignoring server-assigned ids, timestamps,
sequence numbers) shows no material difference. This diff is the deliverable of
the harness in Phase 0 and the gate on every later phase.

Until an action is in the battery and green, we do not claim parity for it.

---

## 2. Scope: the flows to reach parity on

odoo-connect runs 8 event workers (see `odoo-side-architecture.md`). For
OpenMRS to Odoo parity:

| # | Flow | Odoo target | Phase | Notes |
|---|------|-------------|-------|-------|
| 1 | patient → customer | res.partner | 3 (core in 0) | edges: address, attributes, contact, updates |
| 2 | encounter → sale order | sale.order | 2 | the hard one (MapERPOrders) |
| 3 | drug → product | product | 1 | catalogue |
| 4 | lab test → product | product | 1 | catalogue |
| 5 | lab panel → product | product | 1 | catalogue |
| 6 | radiology test → product | product | 1 | catalogue |
| 7 | saleable → product | product | 1 | catalogue |
| 8 | OpenELIS patient → sale order | sale.order | 4 | **decision:** in or out; needs OpenELIS running |

Decision point: flow 8 sources from OpenELIS, not OpenMRS. Strict "OpenMRS to
Odoo" parity is flows 1 to 7. Full odoo-connect parity includes 8. Recommend
flows 1 to 7 for v1 parity, flow 8 as a fast-follow.

---

## 3. Phases

Each phase ends with its flows **green in the parity harness**, not just "coded".

### Phase 0 — Foundations: make ONE flow turnkey and verified
The point of this phase is the machinery, proven on the simplest flow (customer).

- **Provisioning on boot.** The `openfn` profile deploys a `project.yaml` into
  Lightning on first start (deploy action / CLI), creates the OpenMRS and Odoo
  **credentials** from env vars, and enables the **triggers** (cron). Result:
  bring the stack up and the customer sync runs with no manual step.
- **Write mechanism.** Land `callMethod` in the Odoo adaptor (our PR) OR use the
  http-to-`/jsonrpc` path already proven. Go through `process_event`; never
  write Odoo models directly (keeps odoo-side idempotency).
- **Connector switch.** Build the `bahmni-standard-openfn` sibling profile that
  includes every service except `odoo-connect` (verified additive; see
  `odoo-side-architecture.md`). Selecting it = OpenFn is the connector.
- **Parity harness.** Scripted: stand up stack A and stack B, apply the action
  battery via OpenMRS REST, snapshot both Odoo DBs, diff the tracked models,
  emit a report. This is reused by every later phase.
- **Exit:** customer create is turnkey on install and parity-green.

### Phase 1 — Catalogue flows (drug, lab test, lab panel, radiology, saleable)
Simplest transforms (item → product), highest coverage per effort. One workflow
branching on category, five `create.*` calls into `process_event`.
- **Exit:** a fresh install's product catalogue matches odoo-connect's
  (the ~2,384-product baseline) in the harness.

### Phase 2 — Sale order (the hard flow)
Implement the full `MapERPOrders` logic (see `saleorder-transform-spec.md`):
- merge `drugOrders[]` + `orders[]`; qty rules; dedup latest-per-product;
- `dispensed` from encounter observations;
- `visitType` from the **visit** (extra fetch; mandatory or Odoo crashes);
- billing-exempt skip (order-attribute fetch);
- REVISE chaining (fetch previous drug order);
- skip `drugNonCoded`.
Plus the **Odoo master-data prerequisite** (order.type, sale.shop,
order.type.shop.map, product-uuid match, UOM mapping) that gates sale-order
creation for odoo-connect too. See section 5.
- **Exit:** battery items 3 to 7, 9 parity-green (lab, drug, revise, dispensed,
  idempotency).

### Phase 3 — Customer completeness
Address mapping, person attributes, primaryContact, and **updates** (not just
creates). `local_name` already handled.
- **Exit:** battery items 1, 2 parity-green.

### Phase 4 — OpenELIS sale order (if in scope)
Flow 8. Needs the OpenELIS profile in the stack and its feed.

### Phase 5 — Non-functional parity and hardening
Parity is also about behaviour under real conditions:
- **Cursor durability** across restarts (Lightning cron state or Collections).
- **Ordering** and **page catch-up** via `rel="prev-archive"` when behind.
- **Retry / error handling**: a failed run must not advance the cursor
  (at-least-once), matching odoo-connect's markers.
- **Cadence / performance**: poll interval vs odoo-connect's latency; the extra
  per-event fetches (visit, attributes) sized.
- **Observability**: run history is the win over Atomfeed; document it.
- **Secrets**: real credential handling, not env placeholders.

### Phase 6 — Turnkey packaging and the parity report
- One documented install path; selecting OpenFn = the sibling profile.
- Master-data seed bundled or scripted (section 5).
- Publish the parity harness output as evidence: "here is the diff, it is clean."

---

## 4. Cross-cutting fidelity requirements (verified facts, must hold in every flow)

From live testing, these are non-negotiable or the integration silently
diverges:
- Feeds are **oldest-first**; cursor = **last** entry; new work is **after** the
  cursor.
- Entry `content` is a **link**; fetch the payload separately.
- Category casing is inconsistent (`patient`, `drug` lowercase; `Encounter`
  capitalised) — filter case-insensitively.
- **Customer `vals` must include a truthy `local_name`** or the Odoo module
  crashes (del-during-iteration).
- **Sale-order `vals` must include `visitType`** or `create_orders` crashes
  (`NoneType.lower`).
- Products match by **`product.product.uuid == productId`**.
- Go through **`process_event`** (idempotency lives there); never write models
  directly.
- Two of these are **latent bugs in the Bahmni Odoo module** (`local_name`,
  `visitType`) worth reporting upstream regardless.

## 5. The Odoo master-data prerequisite (the `sale.order=0` cause)

Sale-order creation needs `order.type`, `sale.shop`
(name + payment_default_id + warehouse + location), `order.type.shop.map`, and
product-uuid matches. **These are empty on a default Bahmni Odoo and are
required by odoo-connect too** — their absence is why KAH shows zero sale orders.
For a turnkey OpenFn install to be "no worse than odoo-connect", it must either
seed this (via `bahmni_initializer`/seed data) or document it as the same
prerequisite odoo-connect has. Decision: bundle a minimal seed so the install is
self-sufficient.

## 6. Dependencies, risks, and honest constraints

- **Needs a developer.** This is JS workflow work + Docker/provisioning + a test
  harness. Weeks, not days.
- **`callMethod` PR** merging (or commit to the http-`/jsonrpc` path).
- **Master data** and **product-uuid matching** are the biggest parity risks on
  sale orders.
- **OpenELIS** scope decision (flow 8).
- **Bahmni module bugs** (`local_name`, `visitType`) — work around and report.
- **Provisioning specifics** for Lightning first-boot deploy need to be pinned
  down (deploy action, credential creation, initial user/API key).
- Whether OpenFn should target strict behavioural parity at all, versus the
  flows implementations actually use, is a product-scope call (Brandon's team).
  This plan assumes the parity goal as stated.

## 7. What "done" looks like

A fresh machine, stock Bahmni via this repo, `COMPOSE_PROFILES` set to the
OpenFn option. On first boot: Lightning provisions the workflows, credentials,
and triggers; odoo-connect is not running; every flow syncs. The installer runs
the parity harness against a stock stack and gets a **clean diff report**. That
report is the parity claim.
