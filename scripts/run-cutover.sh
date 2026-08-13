#!/usr/bin/env bash
#
# Phase 2 cutover: run Bahmni with OpenFn as the ONLY connector to Odoo.
#
# The legacy Atomfeed consumer (odoo-connect) is scaled to zero rather than
# merely stopped, so it is never started in the first place. This must be
# passed on every `up`; running plain `docker compose up` would bring it back
# and it would double-write into Odoo, invalidating the comparison. That is
# the reason this script exists.
#
# Usage:  ./run-cutover.sh /path/to/bahmni-docker/bahmni-standard [env-file]
#
set -euo pipefail

BAHMNI_DIR="${1:-}"
ENV_FILE="${2:-.env}"

if [[ -z "$BAHMNI_DIR" ]]; then
  echo "Usage: $0 /path/to/bahmni-docker/bahmni-standard [env-file]" >&2
  exit 1
fi

if [[ ! -f "$BAHMNI_DIR/docker-compose.yml" ]]; then
  echo "ERROR: no docker-compose.yml in $BAHMNI_DIR" >&2
  exit 1
fi

cd "$BAHMNI_DIR"

# Refuse to run unless the openfn profile is actually available, otherwise this
# would silently start Bahmni with no connector at all.
if ! grep -q 'openfn' docker-compose.yml; then
  echo "ERROR: this docker-compose.yml has no openfn services." >&2
  echo "       Apply the OpenFn integration profile patch first." >&2
  exit 1
fi

export COMPOSE_PROFILES="${COMPOSE_PROFILES:-bahmni-standard,openfn}"

echo "Profiles     : $COMPOSE_PROFILES"
echo "Env file     : $ENV_FILE"
echo "odoo-connect : DISABLED (scaled to 0) - OpenFn is the only writer to Odoo"
echo

docker compose --env-file "$ENV_FILE" up -d --scale odoo-connect=0

echo
echo "Verifying odoo-connect is not running..."
if docker compose --env-file "$ENV_FILE" ps --services --filter status=running 2>/dev/null | grep -qx 'odoo-connect'; then
  echo "FAIL: odoo-connect is running. The comparison would be invalid." >&2
  exit 1
fi
echo "OK: odoo-connect is not running."
echo
echo "Running services:"
docker compose --env-file "$ENV_FILE" ps --services --filter status=running | sort | sed 's/^/  /'
