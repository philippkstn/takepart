// Bündelt den Server samt aller Abhängigkeiten in einzelne Dateien.
// Auf dem Uberspace (CentOS 7, glibc 2.17) läuft damit kein `npm ci` und es
// gibt keine nativen Module, die dort nicht laden würden.
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/main.ts', migrate: 'src/migrate-cli.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // ws versucht optionale native Beschleuniger zu laden und kommt ohne sie aus
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
