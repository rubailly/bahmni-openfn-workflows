# Cutover test: OpenFn as the OpenMRS-to-Odoo connector

**Goal of this phase:** demonstrate that OpenFn can handle the OpenMRS to Odoo
connection that `odoo-connect` handles today. Not that it can compute a
payload; that it can do the job.

The end state of the test is `odoo-connect` stopped and OpenFn writing to Odoo.

## Why not run both

Running both connectors at once means two writers against the same Odoo
instance, so you cannot attribute any record to either one, and you risk
duplicate writes. Logging-only avoids that, but then nothing has been
integrated and the test proves very little.

Both running is therefore a **development state**, not the result.

## Phases

### Phase 0 — Baseline (odoo-connect only)

Run a stock install and record what the existing connector does, so there is
something to compare against later.

1. `COMPOSE_PROFILES=bahmni-standard ./run-bahmni.sh`
2. Perform a fixed, scripted set of actions in the EMR (register a patient,
   place an order, and so on). Write the script down; it must be repeatable.
3. Capture the resulting Odoo state (the created partner/quotation records) and
   the `odoo-connect` logs.

This baseline is the definition of "correct" for the rest of the test.

### Phase 1 — Dry run (both running, OpenFn writes nothing)

A debugging step, not a deliverable. Use it only to get the mapping right
before anything writes.

1. Enable the `openfn` profile alongside the normal stack.
2. Point the bridge at the feed and let the workflow build the Odoo payload,
   logging it rather than sending it.
3. Compare the logged payload against the Odoo records from Phase 0 and fix the
   mapping until they agree.

Move on as soon as the payloads match. Do not linger here.

### Phase 2 — Cutover (OpenFn only) — this is the actual test

1. Reset to a clean database state so Phase 0's records do not confuse results.
2. Start the stack, then stop the legacy connector:

   ```shell
   docker compose stop odoo-connect
   ```

   No compose file changes are needed. The container simply is not running.
3. Enable writes in the workflow.
4. Replay the **same scripted actions** from Phase 0.
5. Compare the resulting Odoo state against the Phase 0 baseline.

**Pass condition:** the Odoo records produced are equivalent to those the
legacy connector produced for the same inputs.

### Phase 3 — The part that actually matters

Add a destination the current stack cannot reach (a DHIS2 instance, an HIE
endpoint, a registry) and measure the effort. Phase 2 only establishes that
OpenFn is not worse. Phase 3 is where the claim lives.

## Cautions

* **Feed cursors.** `odoo-connect` tracks its own position in the Atom feed.
  If you stop it during Phase 2 and later restart it, it will catch up and
  reprocess everything it missed, which will double-write. Either keep it
  stopped for the duration or reset the environment before restarting it.
* **Clean state between phases.** Comparing against a baseline is only
  meaningful if both runs start from the same database state.
* **Same inputs, literally.** The scripted EMR actions must be identical
  between Phase 0 and Phase 2, or the comparison proves nothing.

## Failure is a real outcome

If Phase 2 passes but Phase 3 shows that adding a destination costs about the
same as it would with existing tooling, then this layer is not worth having.
Write that up and archive the repository rather than continuing quietly.
