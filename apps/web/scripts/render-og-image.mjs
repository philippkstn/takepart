// Rendert scripts/og-image.html mit headless Chrome nach public/og-image.png (1200 × 630).
// Nur bei Änderungen am Bild nötig; das PNG ist eingecheckt.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!chrome) throw new Error('Chrome nicht gefunden – Pfad über CHROME=… angeben');

const source = fileURLToPath(new URL('./og-image.html', import.meta.url));
const target = fileURLToPath(new URL('../public/og-image.png', import.meta.url));
execFileSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1200,630',
  '--virtual-time-budget=2000',
  `--screenshot=${target}`,
  `file://${source}`,
]);
console.log('geschrieben:', target);
