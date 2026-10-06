#!/usr/bin/env bash
# Deployment auf dem Uberspace (wird von GitHub Actions per SSH aufgerufen,
# lässt sich aber auch von Hand ausführen).
#
# Ablauf: entpacken → Migrationen → umschalten → Dienst neu starten →
#         Health-Check → bei Fehler automatisch zurückrollen.
#
# Das Release enthält alles Nötige (gebündelter Server, gebaute Web-App) –
# auf dem Server wird nichts installiert oder gebaut.
#
# Aufruf: deploy.sh <release.tgz> <version>   (version z. B. Git-SHA)
set -euo pipefail

ARCHIVE="${1:?Pfad zum Release-Archiv fehlt}"
VERSION="${2:?Version (z. B. Git-SHA) fehlt}"

BASE="$HOME/slides"
RELEASES="$BASE/releases"
ENV_FILE="$BASE/shared/.env"
CURRENT="$BASE/current"
REL="$RELEASES/$VERSION"
KEEP_RELEASES=5

log() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "FEHLER: $*" >&2; exit 1; }

[[ -f "$ARCHIVE" ]] || die "Archiv $ARCHIVE nicht gefunden"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE fehlt – zuerst setup.sh ausführen"
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE")"
[[ -n "$PORT" ]] || die "PORT fehlt in $ENV_FILE"

PREVIOUS="$(readlink "$CURRENT" 2>/dev/null || true)"

# ─────────────────────────────────────────────────────────────
log "Entpacke Version $VERSION"
if [[ -d "$REL" ]]; then
  [[ "$PREVIOUS" == "$REL" ]] && log "Version $VERSION ist bereits aktiv – wird neu ausgerollt"
  [[ "$PREVIOUS" != "$REL" ]] && rm -rf "$REL"
fi
mkdir -p "$REL"
tar -xzf "$ARCHIVE" -C "$REL"

log "Datenbank-Migrationen"
( cd "$REL/server" && node --env-file="$ENV_FILE" migrate.mjs )

# ─────────────────────────────────────────────────────────────
switch_to() {
  local target="$1"
  ln -sfn "$target" "$CURRENT.tmp"
  mv -Tf "$CURRENT.tmp" "$CURRENT"   # atomarer Wechsel des Symlinks
  cp "$target/deploy/uberspace/slides.ini" "$HOME/etc/services.d/slides.ini"
  supervisorctl reread >/dev/null
  supervisorctl update >/dev/null
  supervisorctl restart slides >/dev/null || supervisorctl start slides >/dev/null
}

healthy() {
  for _ in $(seq 1 20); do
    if curl -fsS "http://localhost:$PORT/api/health" 2>/dev/null | grep -q '"ok"'; then
      return 0
    fi
    sleep 1.5
  done
  return 1
}

log "Schalte auf Version $VERSION um"
switch_to "$REL"

if healthy; then
  log "Health-Check ok: $(curl -fsS "http://localhost:$PORT/api/health")"
else
  log "Health-Check fehlgeschlagen – letzte Log-Zeilen:"
  supervisorctl tail slides stderr 2>/dev/null | tail -n 30 || true
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" && "$PREVIOUS" != "$REL" ]]; then
    log "Rolle zurück auf $(basename "$PREVIOUS")"
    switch_to "$PREVIOUS"
    if healthy; then log "Vorherige Version läuft wieder"; else log "ACHTUNG: auch die vorherige Version antwortet nicht"; fi
    log "Hinweis: Migrationen werden nicht zurückgerollt"
  fi
  rm -f "$ARCHIVE"
  die "Deployment von $VERSION fehlgeschlagen"
fi

# ─────────────────────────────────────────────────────────────
log "Räume auf (behalte $KEEP_RELEASES Versionen)"
active="$(readlink "$CURRENT")"
# shellcheck disable=SC2012  # Versionsordner heißen wie Git-SHAs
ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's:/$::' | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
  [[ "$old" == "$active" || "$old" == "$PREVIOUS" ]] && continue
  rm -rf -- "$old"
done
rm -f "$ARCHIVE"

log "Fertig: Version $VERSION ist live"
