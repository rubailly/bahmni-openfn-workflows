# Question for the OpenFn Lightning team

**Context:** We are packaging a self-hosted Lightning (v2.17.1, Docker) so that
it comes up on first boot with a workflow already deployed, credentials attached,
and a cron trigger enabled — no human clicking in the UI. It runs alongside
Bahmni (OpenMRS + Odoo) as a drop-in for Bahmni's `odoo-connect`.

**What already works** (scripted, headless):
- Create a superuser + API token via `bin/lightning rpc`
  (`Lightning.Accounts.register_superuser/1` + `generate_api_token/1`).
- Create `raw` credentials and link them to a project.
- `openfn deploy` a `project.yaml` (workflow + jobs + cron trigger). The cron
  fires and the ws-worker executes runs end to end.

**Two config gaps we had to fix in our Docker profile (flagging in case they
should be defaults):**
1. The image does not run DB migrations on boot — Lightning crash-loops until we
   run `/app/bin/migrate` first.
2. The ws-worker cannot connect (`HTTP 500` on `/worker/websocket`) because the
   endpoint's `check_origin` is `nil`; setting `ORIGINS` fixes it.

**The actual questions:**

1. **What is the supported way to headlessly provision a project WITH credentials
   attached to its jobs?** `openfn deploy` resolves job credentials only from
   *project-linked* credentials, but on a first deploy no project exists yet
   (chicken-and-egg). We worked around it by deploying without credentials, then
   linking via `rpc`, then re-deploying — but the re-deploy's credential
   name resolution (`hyphenate("owner name")`) still did not pick them up.

2. **How should a `raw` credential's `body` (e.g. `baseUrl`, `username`) reach a
   job as `state.configuration` at run time?** Our deployed job fails with the
   http adaptor's `UNEXPECTED_RELATIVE_URL`, i.e. `configuration.baseUrl` is
   empty at run time even though the credential body has it.

3. **Runs execute against a workflow _snapshot_.** After deploy, editing the live
   job/credential via `rpc` does not affect already-created runs. Is the intended
   model to always re-`deploy` for any change, and is there a supported
   first-boot sequence (create creds → deploy → they are linked in one shot)?

4. Is there an official pattern/example for **first-boot auto-provisioning** of a
   self-hosted Lightning (creds + project + triggers) in Docker, that we should
   follow instead of scripting `rpc`?

**Why it matters:** everything else in the integration is proven end to end
(read OpenMRS feed → transform → write Odoo via `process_event`, for customer,
sale-order, and catalogue flows). The only thing between us and a turnkey
"install and it runs" is this headless credential-provisioning path.
