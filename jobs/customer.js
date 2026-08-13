// Real OpenMRS patient feed -> Odoo customer `vals`, run against a live Bahmni.
get('/openmrs/ws/atomfeed/patient/recent');

// Parse the Atom feed (verified structure: oldest-first, content = REST link in CDATA)
fn(state => {
  const xml = state.data;
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const e = m[1];
    const id = (e.match(/<id>([^<]*)<\/id>/) || [])[1];
    const category = (e.match(/<category term="([^"]*)"/) || [])[1];
    const content = (e.match(/<content[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1];
    return { id, category, content };
  });
  console.log(`feed: ${entries.length} entr${entries.length===1?'y':'ies'}`);
  // newest = last (oldest-first). Phase-1 scope: process the newest patient event.
  const newest = entries[entries.length - 1];
  if (!newest) throw new Error('no patient entries on feed');
  // The http adaptor duplicates an inline query string when baseUrl is set,
  // so split path and query and pass query via the adaptor's option.
  const [path, qs] = newest.content.split('?');
  const query = {};
  (qs || '').split('&').filter(Boolean).forEach(pair => {
    const [k, v] = pair.split('=');
    query[k] = decodeURIComponent(v ?? '');
  });
  console.log('newest content path:', path, 'query:', JSON.stringify(query));
  return { ...state, entry: { ...newest, path, query } };
});

// Fetch the full patient record the entry points at
get(state => state.entry.path, { query: $.entry.query });

// Transform OpenMRS patient -> Odoo customer vals (the shape process_event expects)
fn(state => {
  const p = state.data;
  const ids = p.identifiers || [];
  const preferred = ids.find(i => i.preferred) || ids[0] || {};
  const nm = p.person && p.person.preferredName ? p.person.preferredName : {};
  const vals = {
    category: 'create.customer',
    ref: preferred.identifier,
    uuid: p.uuid,
    name: p.person ? p.person.display : undefined,
    // local_name MUST be truthy: the Odoo module's _create_or_update_customer
    // deletes falsy keys while iterating dict.keys(), which crashes in Py3
    // ("dictionary changed size during iteration"). Verified on a live stack.
    local_name: p.person ? p.person.display : undefined,
    givenName: nm.givenName,
    familyName: nm.familyName,
    gender: p.person && p.person.gender,
    birthdate: p.person && p.person.birthdate,
  };
  console.log('CUSTOMER VALS:', JSON.stringify(vals, null, 2));
  return { vals };
});
