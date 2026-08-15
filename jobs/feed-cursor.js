// Reusable feed cursor with page catch-up.
// Cursor = { pagePath, entryId }. Reads one page/run; advances via next-archive
// so a workflow that falls behind catches up over successive runs, never skips.
// (Feed archive hrefs use the publisher's own scheme/host, so we keep the PATH
// and resolve it against the adaptor baseUrl.)
function parseFeed(xml) {
  const pathOf = u => (u ? u.replace(/^https?:\/\/[^/]+/, '') : null);
  const link = rel => {
    const m = xml.match(new RegExp(`<link rel="${rel}"[^>]*href="([^"]*)"`));
    return m ? pathOf(m[1]) : null;
  };
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const e = m[1];
    return {
      id: (e.match(/<id>([^<]*)<\/id>/) || [])[1],
      content: (e.match(/<content[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1],
    };
  });
  return { entries, self: link('self'), via: link('via'),
           nextArchive: link('next-archive'), prevArchive: link('prev-archive') };
}

// Given the fetched page xml and the incoming cursor, return {toProcess, nextCursor}.
function advance(xml, cursor) {
  const f = parseFeed(xml);
  const eid = cursor && cursor.entryId;
  const idx = eid ? f.entries.findIndex(e => e.id === eid) : -1;
  // entries after the cursor on this page (all of them if cursor not on this page)
  const toProcess = idx === -1 ? f.entries : f.entries.slice(idx + 1);
  const lastId = f.entries.length ? f.entries[f.entries.length - 1].id : eid;
  // If a newer page exists, move forward to it next run; else pin to this page's
  // canonical numbered url (via) so we detect the next page when it appears.
  const nextPage = f.nextArchive || f.via || (cursor && cursor.pagePath);
  return { toProcess, nextCursor: { pagePath: nextPage, entryId: f.nextArchive ? lastId : lastId }, atHead: !f.nextArchive };
}
module.exports = { parseFeed, advance };
