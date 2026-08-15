// Full customer transform: identity + contact + attributes + address.
fn(state => {
  const p = state.data;
  const pref = (p.identifiers||[]).find(i=>i.preferred) || (p.identifiers||[])[0] || {};
  const disp = p.person && p.person.display;
  // person.attributes -> flat {name: value}
  const attrs = {};
  (p.person && p.person.attributes || []).forEach(a => {
    const n = a.attributeType && a.attributeType.display;
    if (n) attrs[n] = a.value;
  });
  const vals = {
    category: 'create.customer',
    ref: pref.identifier, uuid: p.uuid, name: disp, local_name: disp,
    primaryContact: attrs.phoneNumber,          // -> phone
    attributes: attrs,                          // -> res.partner.attributes + email
    preferredAddress: (p.person && p.person.preferredAddress) || {},  // -> address.mapping.service
  };
  console.log('FULL CUSTOMER VALS:', JSON.stringify(vals));
  return { vals };
});
