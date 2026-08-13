// Build the JSON-RPC envelope explicitly, then POST it.
fn(state => ({
  ...state,
  rpcBody: {
    jsonrpc: '2.0', method: 'call',
    params: {
      service: 'object', method: 'execute_kw',
      args: [ state.odoo.db, state.odoo.uid, state.odoo.password,
              'api.event.worker', 'process_event', [ state.vals ] ],
    },
    id: 1,
  },
}));
post('/jsonrpc', $.rpcBody);
fn(state => {
  const r = state.data;
  if (r && r.error) throw new Error('process_event failed: ' + JSON.stringify(r.error.data ? r.error.data.message : r.error));
  console.log('process_event result:', JSON.stringify(r.result));
  return state;
});
