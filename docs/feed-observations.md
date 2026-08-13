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

## Still unverified

* The patient feed was **empty** on the instance observed, so a patient entry
  has not been seen directly. The structure is produced by the same publisher
  and should match, but the exact content path for patient events is still an
  assumption.
* Whether any feed endpoint requires authentication in a default configuration.
  On the instance observed, these returned `200` without credentials.
