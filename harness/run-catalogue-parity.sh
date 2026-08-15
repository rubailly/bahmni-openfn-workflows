#!/usr/bin/env bash
# Catalogue-flow parity: a drug product as produced by odoo-connect [A] vs
# recreated by OpenFn [B], diffed. Uses an existing drug (odoo-connect already
# created the product at setup); no reference-data creation needed.
set -euo pipefail
HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="${STACK:-$PWD}"; cd "$STACK"
ODOO=http://localhost:8069/jsonrpc; DB=odoo; UID_=6
PW=$(grep -m1 '^ODOO_ATOMFEED_PASSWORD=' .env | cut -d= -f2)
OMU=$(grep -m1 '^OPENMRS_ATOMFEED_USER=' .env | cut -d= -f2); OMP=$(grep -m1 '^OPENMRS_ATOMFEED_PASSWORD=' .env | cut -d= -f2)
B=https://localhost:8443
rpc(){ curl -s -X POST -H "Content-Type: application/json" -d "$1" "$ODOO" 2>/dev/null; }
kw(){ rpc "{\"jsonrpc\":\"2.0\",\"method\":\"call\",\"params\":{\"service\":\"object\",\"method\":\"execute_kw\",\"args\":[\"$DB\",$UID_,\"$PW\",$1]},\"id\":1}"; }

# pick a drug on the feed
FEED_URL="${FEED_URL:-drug}"   # atomfeed name (drug|lab|...)
FEED="${FEED:-drug}"           # transform category (drug|test|panel|radiology|saleable)
DE=$(curl -sk "$B/openmrs/ws/atomfeed/$FEED_URL/recent" 2>/dev/null | grep -oE 'CDATA\[[^]]*' | head -1 | sed 's/CDATA\[//')
curl -sk -u "$OMU:$OMP" "$B$DE" > /tmp/h_drug.json 2>/dev/null
DUUID=$(jq -r '.uuid // .id' /tmp/h_drug.json)
echo "### Parity: catalogue/$FEED (uuid $DUUID)"

echo "-- [A] snapshot the product odoo-connect created"
python3 "$HARNESS_DIR/parity.py" snapshot-product "$ODOO" "$DB" "$UID_" "$PW" "$DUUID" "$HARNESS_DIR/csnap-A.json"

echo "-- reset: delete the product"
PID=$(kw "\"product.product\",\"search\",[[[\"uuid\",\"=\",\"$DUUID\"]]]" | jq -c '.result')
[ "$PID" != "[]" ] && kw "\"product.product\",\"unlink\",[$PID]" >/dev/null 2>&1 || true

echo "-- [B] OpenFn: drug payload -> transform -> process_event(create.drug)"
jq -n --slurpfile d /tmp/h_drug.json --arg f "$FEED" '{data:$d[0], feed:$f}' > /tmp/h_dstate.json
VALS=$(cd /home/rbailly/eclipse-workspace/bahmniopenfn/openfn-run && npx openfn "$HARNESS_DIR/../jobs/catalogue-transform.js" -a common -s /tmp/h_dstate.json -o /tmp/h_dvals.json --log none >/dev/null 2>&1; jq -c '.vals' /tmp/h_dvals.json)
kw "\"api.event.worker\",\"process_event\",[$VALS]" >/dev/null
python3 "$HARNESS_DIR/parity.py" snapshot-product "$ODOO" "$DB" "$UID_" "$PW" "$DUUID" "$HARNESS_DIR/csnap-B.json"

echo
python3 "$HARNESS_DIR/parity.py" diff "$HARNESS_DIR/csnap-A.json" "$HARNESS_DIR/csnap-B.json"
