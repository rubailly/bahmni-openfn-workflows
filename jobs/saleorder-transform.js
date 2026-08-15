// Sale-order transform with edges: dispensed (from observations), REVISE flag,
// billing-exempt skip. visitType comes from state.visit (fetched separately).
fn(state => {
  const enc = state.data;
  const visit = state.visit || {};
  const exemptSet = new Set(state.billingExemptOrderUuids || []);
  const providerName = (enc.providers && enc.providers[0] && enc.providers[0].name) || '';
  // visitType from the visit's "Visit Status" attribute
  const visitType = (visit.attributes || [])
    .filter(a => a.attributeType && a.attributeType.display === 'Visit Status')
    .map(a => a.value)[0] || null;
  const obs = enc.observations || [];
  const isDispensed = (orderUuid) => obs.some(o =>
    o.orderUuid === orderUuid && o.concept && String(o.concept.name).toLowerCase() === 'dispensed'
    && (o.value === true || String(o.value).toLowerCase() === 'true'));

  const openERPOrders = [];
  for (const d of enc.drugOrders || []) {
    if (d.drugNonCoded) continue;
    if (exemptSet.has(d.uuid)) continue;                       // billing-exempt skip
    openERPOrders.push({
      orderId: d.uuid, previousOrderId: d.previousOrderUuid || null, encounterId: enc.encounterUuid,
      productId: (d.drug && d.drug.uuid) || d.conceptUuid, productName: (d.drug && d.drug.name) || d.conceptName,
      quantity: (d.dosingInstructions && d.dosingInstructions.quantity) || 0,
      quantityUnits: (d.dosingInstructions && d.dosingInstructions.quantityUnits) || null,
      action: d.action, type: d.orderType, dispensed: isDispensed(d.uuid) ? 'true' : 'false',
      dateCreated: d.dateActivated, providerName, visitType, voided: !!d.voided,
      // REVISE: if action==REVISE and previous not in batch, the workflow must
      // fetch drugOrders/{previousOrderUuid} and add it (flagged for the fetch step)
      _needsPrevious: d.action === 'REVISE' && d.previousOrderUuid ? d.previousOrderUuid : null,
    });
  }
  const latest = {};
  for (const o of enc.orders || []) {
    if (exemptSet.has(o.uuid)) continue;
    const e = { orderId:o.uuid, previousOrderId:o.previousOrderUuid||null, encounterId:enc.encounterUuid,
      productId:o.conceptUuid, productName:o.concept&&o.concept.name, quantity:1, quantityUnits:'Unit(s)',
      action:o.action, type:o.orderType, dispensed: isDispensed(o.uuid)?'true':'false',
      dateCreated:o.dateCreated, providerName, visitType, voided:!!o.voided };
    const prev = latest[e.productId];
    if (!prev || (e.dateCreated||0) >= (prev.dateCreated||0)) latest[e.productId] = e;
  }
  Object.values(latest).forEach(e => openERPOrders.push(e));
  const needPrev = openERPOrders.map(o=>o._needsPrevious).filter(Boolean);
  openERPOrders.forEach(o => delete o._needsPrevious);
  const vals = { category:'create.sale.order', customer_id:enc.patientId, encounter_id:enc.encounterUuid,
    locationName:enc.locationName, orders:{ id:enc.encounterUuid, openERPOrders } };
  console.log('DISPENSED flags:', JSON.stringify(openERPOrders.map(o=>({p:o.productName,d:o.dispensed,v:o.visitType}))));
  console.log('REVISE needs previous fetch:', JSON.stringify(needPrev));
  return { vals, needPreviousOrders: needPrev };
});
