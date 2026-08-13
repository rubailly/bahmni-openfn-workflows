get('/openmrs/ws/atomfeed/patient/recent');
fn(state => {
  const entries = [...state.data.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => ({
    content: (m[1].match(/<content[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1]
  }));
  const [path, qs] = entries[entries.length-1].content.split('?');
  const query = {}; (qs||'').split('&').filter(Boolean).forEach(p=>{const[k,v]=p.split('=');query[k]=decodeURIComponent(v??'')});
  return { ...state, entry: { path, query } };
});
get(state => state.entry.path, { query: $.entry.query });
fn(state => {
  const p = state.data; const pref = (p.identifiers||[]).find(i=>i.preferred) || (p.identifiers||[])[0] || {};
  const disp = p.person && p.person.display;
  return { vals: { category:'create.customer', ref:pref.identifier, uuid:p.uuid, name:disp, local_name:disp, attributes:{}, preferredAddress:{} } };
});
