# Provisioning (Phase 0): deploy the workflow into Lightning on boot

Turns the empty Lightning that the `openfn` profile starts into a running
integration: a cron-triggered workflow that reads the OpenMRS feed and writes to
Odoo via `process_event`. `project.yaml` here is the deployable spec.

## Steps (what a first-boot provisioner must do)

1. **Create a user + API token** (headless), e.g. via the release console:
   `bin/lightning rpc` → `Lightning.Accounts.register_superuser/1` then
   `generate_api_token/1`.
2. **Create the OpenMRS and Odoo credentials** (`schema: raw`) with the internal
   URLs (`http://openmrs:8080`, `http://odoo:8069`) and link them to the project.
3. **Deploy** `project.yaml` with the OpenFn CLI (`openfn deploy`), pointing at
   `http://openfn:4000` with the token.

## Status: proven up to, but not including, the credential wiring

Verified working on the local stack:
- user + token creation, credential creation + project link, project + workflow
  + **cron trigger** deploy, jobs wired.
- **the cron fires automatically** (runs created every 2 min) and the
  **worker executes** the workflow end to end through the adaptor.

Not yet turnkey:
- Getting the raw credential's `baseUrl` into the job at run time, and doing it
  through Lightning's **workflow-snapshot** model (runs execute against the
  deployed snapshot, so post-deploy DB edits do not apply — credentials must be
  correct at deploy time). This is Lightning provisioning mechanics; the OpenFn
  Lightning team (Brandon's team) is the source of truth for the supported
  headless-provisioning path.

## Two profile findings fixed along the way (both in the bahmni-docker fork)

1. **Migrations on boot** — Lightning does not self-migrate; the profile now
   runs `/app/bin/migrate` before the server.
2. **`ORIGINS` env is required** — without it the endpoint's `check_origin` is
   `nil` and the ws-worker cannot connect (HTTP 500 on the worker websocket).
   The profile now sets `ORIGINS`.
