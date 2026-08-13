// Encounter payload -> create.sale.order vals (MapERPOrders logic).
fn(state => {
  const enc = state.data;
  const providerName = (enc.providers && enc.providers[0] && enc.providers[0].name) || '';
  const openERPOrders = [];

  // A. drug orders: skip drugNonCoded; qty from dosingInstructions; date from dateActivated
  for (const d of enc.drugOrders || []) {
    if (d.drugNonCoded) continue;
    // (billing-exempt check omitted here; requires per-order attribute fetch)
    openERPOrders.push({
      orderId: d.uuid, previousOrderId: d.previousOrderUuid || null,
      encounterId: enc.encounterUuid,
      productId: (d.drug && d.drug.uuid) || d.conceptUuid,
      productName: (d.drug && d.drug.name) || d.conceptName,
      quantity: (d.dosingInstructions && d.dosingInstructions.quantity) || 0,
      quantityUnits: (d.dosingInstructions && d.dosingInstructions.quantityUnits) || null,
      action: d.action, type: d.orderType, dispensed: 'false',
      dateCreated: d.dateActivated, providerName, voided: !!d.voided,
    });
  }

  // B. lab/other orders: qty 1; dedup to latest action per product
  const latest = {};
  for (const o of enc.orders || []) {
    const e = {
      orderId: o.uuid, previousOrderId: o.previousOrderUuid || null,
      encounterId: enc.encounterUuid,
      productId: o.conceptUuid, productName: o.concept && o.concept.name,
      quantity: 1, quantityUnits: 'Unit(s)',
      action: o.action, type: o.orderType, dispensed: 'false',
      dateCreated: o.dateCreated, providerName, voided: !!o.voided,
    };
    const prev = latest[e.productId];
    if (!prev || (e.dateCreated || 0) >= (prev.dateCreated || 0)) latest[e.productId] = e;
  }
  Object.values(latest).forEach(e => openERPOrders.push(e));

  const vals = {
    category: 'create.sale.order',
    customer_id: enc.patientId,
    encounter_id: enc.encounterUuid,
    locationName: enc.locationName,
    orders: { id: enc.encounterUuid, openERPOrders },
  };
  console.log('SALE ORDER VALS:', JSON.stringify(vals, null, 2));
  return { vals };
});
