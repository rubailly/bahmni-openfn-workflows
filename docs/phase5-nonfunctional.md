# Phase 5 — non-functional parity (design)

Parity is not only "same records"; it is behaving correctly under real
conditions. This is design + what's already true, not yet all built/deployed
(deployment is gated on the provisioning track). Ordering is called out first
because we *watched* it break odoo-connect.

## 1. Ordering — customer before order (the race that breaks odoo-connect)

**What we observed:** odoo-connect runs the patient feed and encounter feed as
independent jobs with no ordering. When an encounter event is processed before
its patient event, `process_event` returns "Patient Id not found in Odoo" and
the event fails (then NPEs on retry). See `saleorder-reliability-finding.md`.

**OpenFn's approach:** the sale-order workflow must guarantee the customer
exists first. Two safe options:
- **Sequence in one workflow:** customer step → order step, so the partner is
  written before the order (what our manual runs did → succeeded).
- **Guard + retry:** the order step checks the partner exists (`res.partner`
  search by ref) and, if absent, fails cleanly so the run retries later — never
  a hard error, never a lost event.

This is a genuine reliability advantage to preserve deliberately, not by luck.

## 2. Cursor durability — never lose or double-process an event

- The feed cursor is the last-processed entry id, carried in Lightning cron
  state (or Collections for explicit durability). See `bridge/README.md`.
- **Advance the cursor only after a successful write** (final step), giving
  at-least-once processing: a failed run leaves the cursor untouched and the
  next run retries. Combined with `process_event`'s upsert-on-ref/uuid
  idempotency, at-least-once is safe (no duplicates).
- Verify across a Lightning restart: the cursor must survive.

## 3. Retry / failure semantics (match or beat odoo-connect)

- A transient failure (network, Odoo busy) must **retry**, not drop the event.
- A permanent failure (bad data) must be **visible** — this is OpenFn's headline
  advantage over Atomfeed: the failed run, its input payload, and the error are
  in the run history, re-runnable after a fix. Document this as the win.
- The cursor must not advance past a failed event (see §2).

## 4. Page catch-up — falling behind

Feeds page via `rel="next-archive"` (newer) and `rel="prev-archive"` (older). **IMPLEMENTED + verified** - see jobs/feed-cursor.js: one page per run, advance via next-archive, catch up over successive runs, no skips.
the workflow falls more than one page behind (downtime, backlog), it must walk
prev-archive to catch up rather than skip. Not yet implemented; the current
jobs read `recent` only. Needed before claiming durability parity.

## 5. Cadence / performance

- Cron interval vs odoo-connect's effective latency. The sale-order flow makes
  extra per-event fetches (the visit for visitType; order attributes for
  billing-exempt), so size the interval and batch accordingly.
- Catalogue feeds are high-volume at first sync (~2,384 products); ensure a
  first run can page through the backlog without timing out.

## 6. Observability & secrets

- Run history is the observability win — surface it in the install docs.
- Real credential handling (not env placeholders) via Lightning credentials;
  this ties into the provisioning track.

## Exit criteria for Phase 5

- Ordering guard proven (create an encounter for a not-yet-synced patient →
  OpenFn retries and succeeds, no hard failure).
- Cursor survives a Lightning restart; a killed run does not advance it.
- prev-archive catch-up implemented and tested (fall N pages behind → recover).
- A documented cadence that keeps up with a realistic event rate.
