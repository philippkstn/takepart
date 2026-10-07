#!/usr/bin/env bash
# Einmalige Einrichtung auf dem Uberspace (U7) für TakePart.
#
# Idempotent: kann beliebig oft laufen und überspringt, was schon da ist.
# Gibt keine Geheimnisse aus – Passwort und Setup-Token landen nur in
# ~/slides/shared/.env (Rechte 600).
#
# Aufruf auf dem Uberspace:
#   DOMAIN=takepart.philipp-kasten.de bash setup.sh
# Optional: PORT=<freier Port> (sonst wird einer gesucht)
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${DOMAIN:-takepart.philipp-kasten.de}"
BASE="$HOME/slides"
SHARED="$BASE/shared"
ENV_FILE="$SHARED/.env"
DB_NAME="${USER}_slides"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
todo() { printf '  → TODO: %s\n' "$*"; }

command -v uberspace >/dev/null || { echo "Dieses Skript ist für Uberspace 7 gedacht (Befehl 'uberspace' fehlt)." >&2; exit 1; }

# ─────────────────────────────────────────────────────────────
step "Node.js 22"
uberspace tools version use node 22 >/dev/null
ok "Node.js $(node --version)"

# ─────────────────────────────────────────────────────────────
step "Verzeichnisse"
mkdir -p "$BASE"/{releases,shared,incoming} "$HOME/etc/services.d"
chmod 700 "$BASE" "$SHARED"
ok "$BASE/{releases,shared,incoming}"

# ─────────────────────────────────────────────────────────────
step "Datenbank $DB_NAME (MariaDB)"
mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
ok "Datenbank vorhanden"

# ─────────────────────────────────────────────────────────────
step "Konfiguration $ENV_FILE"
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -z "${PORT:-}" ]]; then
    for _ in $(seq 1 50); do
      candidate=$((40000 + RANDOM % 20000))
      if port_free "$candidate"; then PORT=$candidate; break; fi
    done
  fi
  [[ -n "${PORT:-}" ]] || { echo "Kein freier Port gefunden" >&2; exit 1; }
  # Zugangsdaten stehen bei Uberspace in ~/.my.cnf
  DB_PASSWORD="$(my_print_defaults client | sed -n 's/^--password=//p' | head -n1)"
  [[ -n "$DB_PASSWORD" ]] || { echo "Kein MySQL-Passwort in ~/.my.cnf gefunden" >&2; exit 1; }
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=$PORT
HOST=0.0.0.0
APP_ORIGIN=https://$DOMAIN
DB_HOST=localhost
DB_PORT=3306
DB_USER=$USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME
# Proxys vor der App: Uberspace allein 1, mit Cloudflare (Proxy an) davor 2
TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS:-1}
# Einmal-Token für den ersten Passkey. Nach der Einrichtung entfernen.
SETUP_TOKEN=$(openssl rand -hex 16)
ENV
  chmod 600 "$ENV_FILE"
  ok ".env angelegt (Port $PORT)"
  todo "Setup-Token für den ersten Passkey: grep SETUP_TOKEN $ENV_FILE"
else
  ok ".env existiert bereits – unverändert"
fi
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE")"

# ─────────────────────────────────────────────────────────────
step "Domain $DOMAIN"
if uberspace web domain list | grep -qx "$DOMAIN"; then
  ok "Domain bereits eingerichtet"
else
  uberspace web domain add "$DOMAIN"
  todo "DNS-Einträge (A/AAAA) für $DOMAIN wie oben angegeben setzen"
fi

step "Web-Backend $DOMAIN → Port $PORT"
uberspace web backend set "$DOMAIN" --http --port "$PORT" >/dev/null
ok "$(uberspace web backend list | grep "$DOMAIN" || true)"

# ─────────────────────────────────────────────────────────────
step "Dienst slides (supervisord)"
cp "$HERE/slides.ini" "$HOME/etc/services.d/slides.ini"
supervisorctl reread >/dev/null
supervisorctl update >/dev/null
if [[ -L "$BASE/current" ]]; then
  ok "Dienst eingerichtet"
else
  ok "Dienst eingerichtet – startet nach dem ersten Deployment"
fi

printf '\nFertig. Deployments laufen über GitHub Actions (Push auf main).\n'
