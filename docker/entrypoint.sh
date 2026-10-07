#!/bin/sh
# Startet TakePart im Container: erst Migrationen (mit Wartezeit, falls die
# Datenbank noch hochfährt), dann den Server.
set -e
cd /app/server

attempt=1
until node migrate.mjs; do
  if [ "$attempt" -ge 30 ]; then
    echo "Datenbank nicht erreichbar – Abbruch / database unreachable – giving up" >&2
    exit 1
  fi
  echo "Warte auf die Datenbank … / waiting for database … ($attempt)" >&2
  attempt=$((attempt + 1))
  sleep 2
done

exec node server.mjs
