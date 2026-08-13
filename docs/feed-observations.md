# Observed Atom feed behaviour

Verified against a running Bahmni **standard** instance (clinical + lab +
Metabase) on 2026-08-12, by reading the feeds over HTTP. No patient data was
involved; the observations below come from the `drug`, `lab` and `saleable`
feeds, which carry catalogue events only.

These replace assumptions previously baked into `project.yaml`.

## Feed document

```xml
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Patient AOP</title>
  <link rel="self"         href=".../openmrs/ws/atomfeed/drug/recent" />
  <link rel="via"          href=".../openmrs/ws/atomfeed/drug/216" />
  <link rel="prev-archive" href=".../openmrs/ws/atomfeed/drug/215" />
  <author><name>OpenMRS</name></author>
  <id>bec795b1-...-a094019f6984+216</id>
  <generator uri="https://github.com/ICT4H/atomfeed">OpenMRS Feed Publisher</generator>
  <updated>2026-08-06T10:16:12Z</updated>
</feed>
```

* **`<title>` is unreliable.** It reads `Patient AOP` on the *drug* feed. Do not
  use it to identify the feed.
* **`rel="via"`** gives the current page's canonical numbered URL, so `recent`
  is an alias for a specific page number.
* **`rel="prev-archive"`** points at the previous page. Walk this backwards to
  catch up on history. `prev-archive` is absent on the oldest page.
* **`<id>`** is `<feed-uuid>+<page-number>`.

## Entry

```xml
<entry>
  <title>drug</title>
  <category term="drug" />
  <id>tag:atomfeed.ict4h.org:68e8789c-2df2-4e8e-8327-ed4554194b98</id>
  <updated>2026-08-06T10:16:12Z</updated>
  <published>2026-08-06T10:16:12Z</published>
  <content type="application/vnd.atomfeed+xml"><![CDATA[/openmrs/ws/rest/v1/reference-data/drug/a69c062c-...]]></content>
</entry>
```

* **Content is a link, not a payload.** It is a *relative* REST path wrapped in
  CDATA. The consumer must fetch it separately to get the actual record. This
  is why `openerp-atomfeed-service` also calls back into
  `/openmrs/ws/rest/v1/...`.
* **`<id>` is the event id**, formatted `tag:atomfeed.ict4h.org:<uuid>`. It is
  *not* the resource uuid; that appears in the content path.
* **`<category term="...">`** identifies the event type per entry.

## Ordering — the important one

**Entries are oldest-first within a page.** Confirmed by ascending
`<published>` timestamps in document order:

| Feed | Timestamps in document order |
|---|---|
| `saleable/1` | 08:58:46, 08:58:48, 08:58:48, 08:58:50, 08:58:52 |
| `lab/1` | 07:50:20, 07:50:20, 07:50:20, 07:50:20, 07:50:24 |

An earlier version of `project.yaml` assumed newest-first. That logic would
have taken `entries[0]` as the newest and processed nothing but the tail,
silently skipping events. Cursor handling must treat the **last** entry as the
most recent.

## Consequences for the workflow

1. Prime the cursor from the **last** entry on the page, not the first.
2. New work is everything **after** the cursor index, not before it.
3. Advance the cursor to the **last processed** entry.
4. Two HTTP calls per event: fetch the feed, then fetch each entry's content
   path. Budget for that when choosing a cron interval.
5. Paging must be handled if the workflow ever falls more than one page behind.
   Not yet implemented; the current skeleton reads `recent` only.

## Patient and encounter events (verified)

A test patient and a lab order were created on the observed instance, which
produced one entry on each of the `patient` and `encounter` feeds.

```xml
<entry>
  <title>Patient</title>
  <category term="patient" />
  <id>tag:atomfeed.ict4h.org:<event-uuid></id>
  <content type="application/vnd.atomfeed+xml"><![CDATA[/openmrs/ws/rest/v1/patient/<uuid>?v=full]]></content>
</entry>

<entry>
  <title>Encounter</title>
  <category term="Encounter" />
  <id>tag:atomfeed.ict4h.org:<event-uuid></id>
  <content type="application/vnd.atomfeed+xml"><![CDATA[/openmrs/ws/rest/v1/bahmnicore/bahmniencounter/<uuid>?includeAll=true]]></content>
</entry>
```

Four traps here:

1. **Category casing is inconsistent.** `patient` and `drug` are lowercase;
   `Encounter` is capitalised. Filter case-insensitively.
2. **Content paths carry query strings** (`?v=full`, `?includeAll=true`). Use
   the path verbatim; do not reconstruct it or append parameters.
3. **Encounters use a Bahmni-specific namespace**,
   `bahmnicore/bahmniencounter`, not core OpenMRS REST. A generic HTTP call is
   safer here than an OpenMRS-specific adaptor helper.
4. **A lab order arrives on the `encounter` feed, not the `lab` feed.**
   `lab/recent` stayed empty. The `lab`, `drug` and `saleable` feeds carry
   catalogue/reference data. This matches `openerp-atomfeed-service`, whose
   `saleorder.feed.generator.uri` points at `encounter/recent`.

## Authentication asymmetry

* **Feeds:** returned `200` with **no credentials**.
* **Content endpoints:** returned `401`; the documented Bahmni defaults worked.

So the workflow needs a credential for the second call but not the first. Worth
noting that the feeds enumerate drug and lab catalogues to anyone who can reach
the host.

## Payload fields available for mapping

`/openmrs/ws/rest/v1/patient/<uuid>?v=full`:

```
uuid, display
identifiers[] -> identifier, identifierType.display, preferred
person -> gender, age, birthdate, preferredName{givenName, familyName},
          names[], addresses[], attributes[]
auditInfo -> dateCreated, dateChanged, changedBy
```

`/openmrs/ws/rest/v1/bahmnicore/bahmniencounter/<uuid>?includeAll=true`:

```
patientId, patientUuid
encounterType, encounterUuid, visitUuid, visitType
encounterDateTime      <- epoch millis (integer), NOT an ISO string
locationName, locationUuid
providers[] -> uuid, name, encounterRoleUuid
orders[]    -> orderNumber, orderType, action, urgency, dateCreated (epoch),
               concept{uuid, name, shortName, conceptClass, units, mappings[]}
drugOrders[]           <- separate array from orders[]
observations[], bahmniDiagnoses[]
```

`orders[]` is the billable content a sale order would be built from, and
`concept.mappings[]` carries external code mappings usable for matching an
Odoo product. Note `orders[]` and `drugOrders[]` are distinct;
`openerp-atomfeed-service` also calls `/openmrs/ws/rest/v1/bahmnicore/drugOrders`
separately.

## The same resource emits repeated events — idempotency is mandatory

Adding a lab order and then a drug order to the **same** encounter produced
**two** entries on the `encounter` feed, with different event ids and
timestamps but the **identical content URL**:

```
1. 2026-08-12T19:40:56Z  /openmrs/ws/rest/v1/bahmnicore/bahmniencounter/<uuid>?includeAll=true
2. 2026-08-12T19:49:14Z  /openmrs/ws/rest/v1/bahmnicore/bahmniencounter/<uuid>?includeAll=true
```

An event says *"this encounter changed"*, not *"here is a new thing"*. Fetching
the content URL always returns the **current full state** of the encounter, not
a delta. After the second event the payload contained `orders: 1` **and**
`drugOrders: 1`.

The consequence is the single most important design constraint found so far:

> A consumer that creates an Odoo line per order per event will **double-bill**
> the lab test, because the second event re-presents it alongside the new drug
> order.

The consumer must be idempotent, keyed on something stable like the order
`uuid` or `orderNumber`, upserting rather than inserting. How
`openerp-atomfeed-service` handles this is worth reading before writing the
mapping, and the Phase 0 baseline should include this exact scenario: add two
orders to one encounter and check whether Odoo ends up with two lines or three.

It also confirms oldest-first ordering a second time, now with genuinely
distinct timestamps.

## `orders[]` and `drugOrders[]` have different shapes

Lab orders land in `orders[]`, drug orders in `drugOrders[]`, within the same
encounter payload. They are not interchangeable.

`drugOrders[]` adds:

```
drug{name, uuid, form, strength}
dosingInstructions{dose, doseUnits, route, frequency, asNeeded,
                   administrationInstructions, quantity, quantityUnits,
                   numberOfRefills}
duration, durationUnits, dosingInstructionType, drugNonCoded
dateActivated, scheduledDate, effectiveStartDate, effectiveStopDate  <- epoch
careSetting, autoExpireDate
```

For billing, `dosingInstructions.quantity` and `quantityUnits` are the
quantities; a lab order has no equivalent and is effectively quantity 1. This is
presumably why `openerp-atomfeed-service` has a separate
`drugorder.uri=/openmrs/ws/rest/v1/bahmnicore/drugOrders` endpoint.

**Field population is inconsistent between the two.** On the observed data,
`dateCreated` was an epoch integer on the lab order but `null` on the drug
order, and `urgency` was populated on the lab order but `null` on the drug
order. Use `dateActivated` for drug orders rather than `dateCreated`, and do not
assume a field present on one is present on the other.

## Reliability

One request returned a transient `500` before five consecutive `200`s. The feed
can fail intermittently, so the cursor must not advance on failure. The current
design satisfies this: the cursor is written in a final step that only runs if
everything upstream succeeded.

## Still unverified

* Whether the feed requires authentication in configurations other than the one
  observed.
* Page-boundary catch-up via `rel="prev-archive"` has not been exercised.
