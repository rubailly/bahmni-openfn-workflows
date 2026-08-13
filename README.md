# bahmni-openfn-workflows

> **⚠️ EXPERIMENTAL — SKELETON, NOT WORKING SOFTWARE**
>
> This repository contains an early exploration of OpenFn as a transformation
> and routing layer for Bahmni. Nothing here has been run against a live Bahmni
> instance. The workflow expressions are illustrative and carry `TODO` markers
> where real mappings are needed.
>
> It is not an official Bahmni component, and it is not a supported OpenFn
> product. Do not use it in production.
>
> **Disclosure:** the author works at [OpenFn](https://openfn.org).

## What this is

A companion to an optional `openfn` Docker Compose profile for
[bahmni-docker](https://github.com/Bahmni/bahmni-docker). That profile provides
the runtime (an OpenFn Lightning instance). This repository provides the
content: workflow definitions, mapping logic, and the bridge that forwards
OpenMRS events into Lightning.

The split is deliberate. Bahmni's install repository should not take on
responsibility for integration content that changes independently of it.

## What question this is trying to answer

Bahmni already has event-driven integration. [openmrs-eip](https://github.com/openmrs/openmrs-eip)
(OpenMRS org, with significant Mekom Solutions contribution) captures changes
via Debezium on the MySQL binlog and dispatches them onto Apache Camel routes,
and [openmrs-dbsync](https://github.com/mekomsolutions/openmrs-dbsync) builds
instance-to-instance sync on top of it. **This repository does not attempt to
replace or duplicate any of that.**

The narrow open question is about the layer *above* change capture:

> Once change capture is solved, is the remaining work of transforming and
> routing events to multiple destinations a real burden for implementers, and
> would a low-code layer for that work be worth having?

If the answer turns out to be no, this repository should be archived.

## Approach: shadow mode first, not parity

The tempting goal is feature parity with Bahmni's existing integrations, so
that installing with the `openfn` profile does everything `odoo-connect` does.
That is the wrong first step: parity is large, pays nothing until complete,
and tests none of the claim above.

Instead:

1. **Shadow.** Run alongside the existing Atomfeed services. Consume the same
   events, build the payload that *would* be sent, log it, and write nothing.
   Diff against what `odoo-connect` actually produced.
2. **Diverge.** Add one destination the current stack cannot reach (a DHIS2
   instance, an HIE endpoint). This is the part that tests the actual claim.
3. **Only then** consider whether replacing anything makes sense.

Step 1 is falsifiable in weeks. Step 3 may never be justified, and that is an
acceptable outcome.

## Layout

```
project.yaml     Lightning project spec (portability schema 4.0) - SKELETON
bridge/          Forwards OpenMRS events into Lightning - DESIGN ONLY, no code
docs/            Notes on shadow-mode comparison
```

## Deploying the project spec

Requires the [OpenFn CLI](https://www.npmjs.com/package/@openfn/cli) and a
running Lightning instance (see the `openfn` profile in bahmni-docker).

```shell
npm install -g @openfn/cli
cp config.json.example config.json   # point at your Lightning instance
openfn deploy -c config.json
```

`openfn deploy` maintains a local `state.json` mapping spec keys to Lightning
UUIDs. Commit `state.json` if you want reproducible redeploys; it contains no
secrets, but check before committing.

## Status of each piece

| Piece | Status |
|---|---|
| Compose profile (in bahmni-docker fork) | Written, `docker compose config` validated, never started |
| `project.yaml` | Skeleton, parses, never deployed |
| Bridge | Design notes only, no implementation |
| Mappings | Placeholders with TODOs |

## Contributing

If you have run openmrs-eip in production, the most useful thing you can tell
us is how much of the effort sits in change capture versus in writing and
maintaining transformation routes. If the routes are the easy part, this
repository is not worth continuing.
