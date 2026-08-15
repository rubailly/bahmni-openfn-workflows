// Feed reader with page catch-up, as an OpenFn job (one page per run).
// Cursor lives in state.cursor = { pagePath, entryId } and is carried across
// cron runs. Falls behind safely: advances via next-archive over successive runs.
// Advance the cursor ONLY in the final step (after the writes) for at-least-once.

// 1. read the cursor's page (or the head feed on first run)
get(state => (state.cursor && state.cursor.pagePath) || '/openmrs/ws/atomfeed/drug/recent');

// 2. compute what's new on this page + where the cursor goes next
fn(state => {
  const xml = state.data;
  const pathOf = u => (u ? u.replace(/^https?:\/\/[^/]+/, '') : null);
  const link = rel => { const m = xml.match(new RegExp(`<link rel="${rel}"[^>]*href="([^"]*)"`)); return m ? pathOf(m[1]) : null; };
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => ({
    id: (m[1].match(/<id>([^<]*)<\/id>/) || [])[1],
    content: (m[1].match(/<content[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1],
  }));
  const nextArchive = link('next-archive'), via = link('via');
  const cur = state.cursor || {};

  // FIRST RUN prime (no cursor): for patient/encounter, process nothing and pin
  // to head so history isn't replayed. For catalogue, processing all on first
  // run is desirable (matches odoo-connect's initial catalogue sync) — flip
  // PRIME to false there.
  const PRIME = true;
  if (!cur.entryId && PRIME && !nextArchive) {
    const lastId = entries.length ? entries[entries.length-1].id : null;
    console.log('first run: priming cursor, processing nothing');
    return { ...state, toProcess: [], cursor: { pagePath: via, entryId: lastId } };
  }

  const idx = cur.entryId ? entries.findIndex(e => e.id === cur.entryId) : -1;
  const toProcess = idx === -1 ? entries : entries.slice(idx + 1);   // all if cursor not on page (fell behind) => reprocess-safe, never skip
  const lastId = entries.length ? entries[entries.length-1].id : cur.entryId;
  console.log(`${toProcess.length} to process on ${cur.pagePath || 'recent'}` + (nextArchive ? ' (more pages ahead)' : ' (head)'));
  return { ...state, toProcess, nextCursor: { pagePath: nextArchive || via, entryId: lastId } };
});

// 3. process each new entry (fetch its content, transform, write) ...
//    each($.toProcess, get(...).then(transform).then(write via process_event))
//    (omitted here; see customer/saleorder/catalogue jobs for the per-entry work)

// 4. advance the cursor LAST, only after the writes succeeded (at-least-once).
fn(state => ({ ...state, cursor: state.nextCursor, toProcess: [], nextCursor: undefined }));
