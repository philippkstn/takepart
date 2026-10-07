# syntax=docker/dockerfile:1
#
# TakePart als Container: ein Node-Prozess liefert Web-App, API und WebSockets aus.
#
# Die Build-Stufe läuft auf der Plattform des Build-Rechners ($BUILDPLATFORM): ihr
# Ergebnis ist reines JavaScript (mit esbuild gebündelter Server + statische Web-App).
# Die Laufzeit-Stufe kopiert nur Dateien – Multi-Arch-Images (amd64/arm64) brauchen
# so keine Emulation, und im Image liegt kein node_modules.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
ARG REVISION=dev
RUN npm run build && echo "$REVISION" > /src/REVISION

FROM node:22-alpine
LABEL org.opencontainers.image.title="TakePart" \
      org.opencontainers.image.description="Interaktive Vorträge mit Live-Beteiligung – Abstimmungen, Q&A, Quiz, Satz-Spiel" \
      org.opencontainers.image.source="https://github.com/philippkstn/takepart" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build /src/apps/server/dist/server.mjs /src/apps/server/dist/migrate.mjs ./server/
COPY --from=build /src/apps/web/dist ./web
COPY --from=build /src/REVISION ./REVISION
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/takepart
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["takepart"]
