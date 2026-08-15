// Catalogue flows: OpenMRS reference-data -> Odoo product `vals`.
// One transform for all 5 categories; branch on the feed the entry came from.
// state.feed is one of: drug | test | panel | radiology | saleable
//
// Verified via process_event on a live stack for `drug` (drug.data.service)
// and `test` (reference.data.service, shared by panel/radiology/saleable).
fn(state => {
  const d = state.data;
  const feed = state.feed;
  let vals;
  if (feed === 'drug') {
    // drug.data.service.create_or_update_drug
    vals = {
      category: 'create.drug',
      uuid: d.uuid, name: d.name,
      shortName: d.shortName,        // -> default_code
      genericName: d.genericName,    // -> drug
      dosageForm: d.dosageForm,      // -> product category
    };
  } else {
    // reference.data.service.create_or_update_ref_data
    // reference-data payloads use `id` and `isActive`, not uuid/is_active
    const cat = {
      test: 'create.lab.test',
      panel: 'create.lab.panel',
      radiology: 'create.radiology.test',
      saleable: 'create.service.saleable',
    }[feed];
    vals = { category: cat, uuid: d.id || d.uuid, name: d.name, is_active: d.isActive };
  }
  console.log('CATALOGUE VALS:', JSON.stringify(vals));
  return { vals };
});
