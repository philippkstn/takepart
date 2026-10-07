// Kopiert die Hilfsdateien von pdf.js (Schriften, CMaps, WASM-Decoder) nach public/pdfjs.
// Sie werden nur beim PDF-Import geladen. Nicht eingecheckt (.gitignore).
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const target = join(here, '..', 'public', 'pdfjs');
mkdirSync(target, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) cpSync(join(pkg, dir), join(target, dir), { recursive: true });
console.log('pdf.js-Dateien kopiert nach public/pdfjs');
