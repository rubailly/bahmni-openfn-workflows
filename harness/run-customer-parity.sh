#!/usr/bin/env bash
# Customer-flow parity: same patient synced by odoo-connect (A) vs OpenFn (B),
# Odoo state diffed. Run from the bahmni-standard stack dir.
set -euo pipefail
HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="${STACK:-$PWD}"
cd "$STACK"
ODOO=http://localhost:8069/jsonrpc; DB=odoo; UID_=6
PW=$(grep -m1 '^ODOO_ATOMFEED_PASSWORD=' .env | cut -d= -f2)
OMU=$(grep -m1 '^OPENMRS_ATOMFEED_USER=' .env | cut -d= -f2)
OMP=$(grep -m1 '^OPENMRS_ATOMFEED_PASSWORD=' .env | cut -d= -f2)
B=https://localhost:8443; IDTYPE=d3153eb0-5e07-11ef-8f7c-0242ac120002; LOC=72636eba-29bf-4d6c-97c4-4b04d87a95b5
STAMP="${STAMP:?pass STAMP for a unique ref per run}"; PFX="HARN${STAMP}"; REF="$PFX"
rpc(){ curl -s -X POST -H "Content-Type: application/json" -d "$1" "$ODOO" 2>/dev/null; }
kw(){ rpc "{\"jsonrpc\":\"2.0\",\"method\":\"call\",\"params\":{\"service\":\"object\",\"method\":\"execute_kw\",\"args\":[\"$DB\",$UID_,\"$PW\",$1]},\"id\":1}"; }
delpartner(){ local id; id=$(kw "\"res.partner\",\"search\",[[[\"ref\",\"=\",\"$REF\"]]]" | jq -c '.result'); [ "$id" != "[]" ] && kw "\"res.partner\",\"unlink\",[$id]" >/dev/null || true; }

echo "### Parity: customer flow (ref $REF)"
delpartner
echo "-- create patient via OpenMRS REST"
PUUID=$(curl -sk -u "$OMU:$OMP" -X POST "$B/openmrs/ws/rest/v1/patient" -H 'Content-Type: application/json' \
  -d "{\"identifiers\":[{\"identifier\":\"$REF\",\"identifierType\":\"$IDTYPE\",\"location\":\"$LOC\",\"preferred\":true}],\"person\":{\"names\":[{\"givenName\":\"Parity\",\"familyName\":\"Test\"}],\"gender\":\"M\",\"birthdate\":\"1990-01-01\",\"attributes\":[{\"attributeType\":\"a384873b-847a-4a86-b869-28fb601162dd\",\"value\":\"0700111222\"}]}}" 2>/dev/null | jq -r '.uuid')
echo "   patient uuid=$PUUID"
[ "$PUUID" = "null" ] && { echo "   ERROR: patient create failed"; exit 1; }

echo "-- [A] odoo-connect ON: sync + snapshot"
COMPOSE_PROFILES=emr,odoo,openfn docker compose --env-file .env start odoo-connect >/dev/null 2>&1
n=0; until [ "$(kw "\"res.partner\",\"search_count\",[[[\"ref\",\"=\",\"$REF\"]]]" | jq -c '.result')" != "0" ]; do n=$((n+1)); [ $n -ge 40 ] && { echo "   odoo-connect timeout"; break; }; sleep 3; done
python3 "$HARNESS_DIR/parity.py" snapshot "$ODOO" "$DB" "$UID_" "$PW" "$PFX" "$HARNESS_DIR/snap-A.json"

echo "-- reset: delete partner, stop odoo-connect"
delpartner
COMPOSE_PROFILES=emr,odoo,openfn docker compose --env-file .env stop odoo-connect >/dev/null 2>&1

echo "-- [B] OpenFn: fetch patient -> transform -> process_event"
curl -sk -u "$OMU:$OMP" "$B/openmrs/ws/rest/v1/patient/$PUUID?v=full" > /tmp/h_patient.json 2>/dev/null
jq -n --slurpfile p /tmp/h_patient.json '{data:$p[0]}' > /tmp/h_state.json
VALS=$(cd /home/rbailly/eclipse-workspace/bahmniopenfn/openfn-run && npx openfn "/home/rbailly/eclipse-workspace/bahmniopenfn/bahmni-openfn-workflows/jobs/customer-full-transform.js" -a common -s /tmp/h_state.json -o /tmp/h_vals.json --log none >/dev/null 2>&1; jq -c '.vals' /tmp/h_vals.json)
kw "\"api.event.worker\",\"process_event\",[$VALS]" >/dev/null
python3 "$HARNESS_DIR/parity.py" snapshot "$ODOO" "$DB" "$UID_" "$PW" "$PFX" "$HARNESS_DIR/snap-B.json"

echo
python3 "$HARNESS_DIR/parity.py" diff "$HARNESS_DIR/snap-A.json" "$HARNESS_DIR/snap-B.json"
