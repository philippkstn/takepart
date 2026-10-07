import type { HostCommand } from '@slides/shared';
import { useEffect, useRef } from 'react';

/**
 * Tastenbelegung wie in PowerPoint – damit funktionieren auch Presenter
 * („Clicker“), die nichts anderes als Tastendrücke senden:
 *
 *   weiter   → ↓ Bild↓ Leertaste Enter N
 *   zurück   ← ↑ Bild↑ Rücktaste P
 *   schwarz  B oder .   (die „Bildschirm aus“-Taste vieler Presenter)
 *   weiß     W oder ,
 *   Anfang/Ende  Pos1 / Ende
 *   Folie n  Nummer tippen, dann Enter
 */
export function usePresenterKeys(
  send: ((cmd: HostCommand) => unknown) | null,
  blank: 'black' | 'white' | null,
  extra?: (e: KeyboardEvent) => boolean,
) {
  // Aktuelle Werte für den einmal registrierten Listener
  const latest = useRef({ send, blank, extra });
  latest.current = { send, blank, extra };
  const digits = useRef({ value: '', at: 0 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { send, blank, extra } = latest.current;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      if (extra?.(e)) return;
      if (!send) return;

      const run = (cmd: HostCommand) => {
        e.preventDefault();
        void send(cmd);
      };

      if (/^[0-9]$/.test(e.key)) {
        const now = Date.now();
        const d = digits.current;
        d.value = (now - d.at < 2000 ? d.value : '') + e.key;
        d.at = now;
        return;
      }
      if (e.key === 'Enter' && digits.current.value && Date.now() - digits.current.at < 2000) {
        const n = Number(digits.current.value);
        digits.current.value = '';
        if (n >= 1) run({ action: 'jump', index: n - 1 });
        return;
      }
      digits.current.value = '';
      // Leertaste/Enter auf einem fokussierten Knopf lösen diesen aus
      if ((e.key === ' ' || e.key === 'Enter') && target?.closest('button, a, summary')) return;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
        case 'n':
        case 'N':
          return run({ action: 'step', delta: 1 });
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
        case 'p':
        case 'P':
          return run({ action: 'step', delta: -1 });
        case 'b':
        case 'B':
        case '.':
          return run({ action: 'blank', mode: blank === 'black' ? null : 'black' });
        case 'w':
        case 'W':
        case ',':
          return run({ action: 'blank', mode: blank === 'white' ? null : 'white' });
        case 'Escape':
          if (blank) run({ action: 'blank', mode: null });
          return;
        case 'Home':
          return run({ action: 'jump', index: 0 });
        case 'End':
          return run({ action: 'jump', index: -1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
