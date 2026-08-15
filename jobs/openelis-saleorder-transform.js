// OpenELIS lab order -> create.sale.order vals (flow 8).
// Reference: OpenElisLabOrder.getParameters / addNewOrder.
// Simpler than the OpenMRS flow: no visit, no dispensed, no dedup, no billing-exempt.
fn(state => {
  const o = state.data;   // OpenElisLabOrder
  const openERPOrders = (o.testDetails || [])
    // panels dedup: a panel present once; skip a test already covered by a panel
    .filter(td => td.panelUuid == null || !(state._seenPanels||[]).includes(td.panelUuid))
    .map(td => ({
      // orderId is the idempotency key (-> sale.order.line.external_order_id).
      // OpenELIS has no order uuid, so use a stable accession+test composite.
      orderId: o.accessionUuid + '-' + (td.panelUuid || td.testUuid),
      encounterId: o.accessionUuid,
      productId: td.panelUuid || td.testUuid,   // panel product if a panel, else the test
      quantity: 1, quantityUnits: 'Unit(s)',   // a lab test is qty 1 (Java omits this too)
      previousOrderId: null,
      // OpenElisTestDetail carries only uuids (no name); the product matches by
      // uuid so the name is cosmetic. A real feed may include a test name to use.
      productName: td.testName || (td.panelUuid || td.testUuid),
      conceptName: td.testName || (td.panelUuid || td.testUuid),
      voided: !!td.cancelled,
      type: state.orderType || 'Lab Order',   // OpenELIS tests are lab orders; the Java
      // reference omits this, so Odoo silently skips the order. Set it explicitly.
      visitType: state.visitType || 'OPD',    // OpenELIS has no visit; Odoo needs it
      // for care_setting or process_event crashes (NoneType.lower). Java omits it.
      // OpenELIS has no visit/dispensed/quantity info; Odoo defaults apply
    }));
  const vals = {
    category: 'create.sale.order',
    customer_id: o.patientIdentifier,
    orders: { id: o.accessionUuid, openERPOrders },
  };
  console.log('OPENELIS SALE ORDER VALS:', JSON.stringify(vals));
  return { vals };
});
