#!/usr/bin/env bash
# Sale-order parity: encounter+lab-order synced by odoo-connect [A] vs OpenFn [B].
set -euo pipefail
HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"; STACK="${STACK:-$PWD}"; cd "$STACK"
ODOO=http://localhost:8069/jsonrpc; DB=odoo; UID_=6
PW=$(grep -m1 '^ODOO_ATOMFEED_PASSWORD=' .env|cut -d= -f2)
OMU=$(grep -m1 '^OPENMRS_ATOMFEED_USER=' .env|cut -d= -f2); OMP=$(grep -m1 '^OPENMRS_ATOMFEED_PASSWORD=' .env|cut -d= -f2)
B=https://localhost:8443; A="-sk -u $OMU:$OMP"
IDTYPE=d3153eb0-5e07-11ef-8f7c-0242ac120002; LOC=72636eba-29bf-4d6c-97c4-4b04d87a95b5
ENCTYPE=d34fe3ab-5e07-11ef-8f7c-0242ac120002; VISIT=54f43754-c6ce-4472-890e-0f28acaeaea6
CONCEPT=163700AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; PROV=05d6752c-5e08-11ef-8f7c-0242ac120002; LABTYPE=d3560b17-5e07-11ef-8f7c-0242ac120002
REF="SO${STAMP:?pass STAMP}"
rpc(){ curl -s -X POST -H "Content-Type: application/json" -d "$1" "$ODOO" 2>/dev/null; }
kw(){ rpc "{\"jsonrpc\":\"2.0\",\"method\":\"call\",\"params\":{\"service\":\"object\",\"method\":\"execute_kw\",\"args\":[\"$DB\",$UID_,\"$PW\",$1]},\"id\":1}"; }
proc(){ kw "\"api.event.worker\",\"process_event\",[$1]" >/dev/null; }
reset_partner(){ local id; id=$(kw "\"res.partner\",\"search\",[[[\"ref\",\"=\",\"$REF\"]]]" | jq -c '.result'); [ "$id" != "[]" ] && { local so; so=$(kw "\"sale.order\",\"search\",[[[\"partner_id\",\"in\",$id]]]" | jq -c '.result'); [ "$so" != "[]" ] && kw "\"sale.order\",\"unlink\",[$so]" >/dev/null 2>&1 || true; kw "\"res.partner\",\"unlink\",[$id]" >/dev/null 2>&1 || true; } || true; }
transform(){ cd /home/rbailly/eclipse-workspace/bahmniopenfn/openfn-run && npx openfn "$1" -a common -s "$2" -o "$3" --log none >/dev/null 2>&1; jq -c '.vals' "$3"; }

echo "### Parity: sale-order flow (ref $REF)"
reset_partner
echo "-- create patient + encounter with a lab order"
PUUID=$(curl $A -X POST "$B/openmrs/ws/rest/v1/patient" -H 'Content-Type: application/json' -d "{\"identifiers\":[{\"identifier\":\"$REF\",\"identifierType\":\"$IDTYPE\",\"location\":\"$LOC\",\"preferred\":true}],\"person\":{\"names\":[{\"givenName\":\"SaleOrder\",\"familyName\":\"Test\"}],\"gender\":\"M\",\"birthdate\":\"1990-01-01\"}}" 2>/dev/null | jq -r '.uuid')
ENC=$(curl $A -X POST "$B/openmrs/ws/rest/v1/bahmnicore/bahmniencounter" -H 'Content-Type: application/json' -d "{\"patientUuid\":\"$PUUID\",\"encounterTypeUuid\":\"$ENCTYPE\",\"visitTypeUuid\":\"$VISIT\",\"locationUuid\":\"$LOC\",\"providers\":[{\"uuid\":\"$PROV\"}],\"orders\":[{\"concept\":{\"uuid\":\"$CONCEPT\"},\"orderTypeUuid\":\"$LABTYPE\"}]}" 2>/dev/null | jq -r '.encounterUuid')
echo "   patient=$REF enc=$ENC"

echo "-- [A] odoo-connect ON: sync partner+sale.order"
COMPOSE_PROFILES=emr,odoo,openfn docker compose --env-file .env start odoo-connect >/dev/null 2>&1
n=0; until [ "$(kw "\"sale.order\",\"search_count\",[[[\"partner_id.ref\",\"=\",\"$REF\"]]]" | jq -c '.result // 0')" != "0" ]; do n=$((n+1)); [ $n -ge 50 ] && { echo "   [A] no sale order within ~150s"; break; }; sleep 3; done
python3 "$HARNESS_DIR/parity.py" snapshot-saleorder "$ODOO" "$DB" "$UID_" "$PW" "$REF" "$HARNESS_DIR/sosnap-A.json"

echo "-- reset: delete sale order+partner, stop odoo-connect"
reset_partner
COMPOSE_PROFILES=emr,odoo,openfn docker compose --env-file .env stop odoo-connect >/dev/null 2>&1

echo "-- [B] OpenFn: customer then sale-order via process_event"
curl $A "$B/openmrs/ws/rest/v1/patient/$PUUID?v=full" > /tmp/so_p.json 2>/dev/null
jq -n --slurpfile p /tmp/so_p.json '{data:$p[0]}' > /tmp/so_pstate.json
proc "$(transform "$HARNESS_DIR/../jobs/customer-full-transform.js" /tmp/so_pstate.json /tmp/so_pvals.json)"
curl $A "$B/openmrs/ws/rest/v1/bahmnicore/bahmniencounter/$ENC?includeAll=true" > /tmp/so_e.json 2>/dev/null
VUUID=$(jq -r '.visitUuid' /tmp/so_e.json)
curl $A "$B/openmrs/ws/rest/v1/visit/$VUUID?v=full" > /tmp/so_v.json 2>/dev/null
jq -n --slurpfile e /tmp/so_e.json --slurpfile v /tmp/so_v.json '{data:$e[0], visit:$v[0]}' > /tmp/so_estate.json
proc "$(transform "$HARNESS_DIR/../jobs/saleorder-transform.js" /tmp/so_estate.json /tmp/so_evals.json)"
python3 "$HARNESS_DIR/parity.py" snapshot-saleorder "$ODOO" "$DB" "$UID_" "$PW" "$REF" "$HARNESS_DIR/sosnap-B.json"

echo
python3 "$HARNESS_DIR/parity.py" diff "$HARNESS_DIR/sosnap-A.json" "$HARNESS_DIR/sosnap-B.json"
