import type { HostView } from '@slides/shared';
import { FlaskConical, MessageSquareShare, Monitor, MonitorOff, Shuffle, Trash2, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { formatCode, joinHost, joinUrl, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useConfirm } from '../../components/ConfirmDialog.tsx';

/**
 * Bausteine fürs Steuerpult: Probelauf (Hinweis, Testteilnehmende, Beenden mit
 * Rückfrage), Einladung für Teams-/Zoom-Chat und die Anzeige, ob das
 * Beamer-Fenster gerade sichtbar ist.
 */

/** Deutlicher Hinweis in der Kopfzeile: Dieser Lauf landet nicht im Archiv. */
export function RehearsalBadge() {
  return (
    <span className="pill pill-warn" title="Probelauf – erscheint nicht als Durchführung im Archiv und blockiert keinen echten Live-Start">
      <FlaskConical /> Probelauf – wird nicht archiviert
    </span>
  );
}

const INVITE_INTRO = 'einfach mit dem Handy oder im Browser, ohne Anmeldung und ohne App';

/**
 * Einladung für den Chat einer Online-Sitzung (Teams, Zoom …): Titel, der Link
 * allein in einer Zeile (Teams zeigt dazu die Vorschau „Mach mit – Code …“) und
 * der Code für alle, die lieber tippen.
 */
export function invitationText(code: string | null, title?: string): string {
  const what = title ? `bei „${title}“` : '';
  return [
    `Macht mit ${what}`.trim() + ` – ${INVITE_INTRO}:`,
    '',
    joinUrl(code),
    '',
    `Oder auf ${joinHost()} den Code ${formatCode(code)} eingeben.`,
  ].join('\n');
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Dieselbe Einladung formatiert – Teams und Outlook übernehmen Fettdruck und Link beim Einfügen */
export function invitationHtml(code: string | null, title?: string): string {
  const url = escapeHtml(joinUrl(code));
  const what = title ? ` bei <b>„${escapeHtml(title)}“</b>` : '';
  return [
    `<p>Macht mit${what} – ${INVITE_INTRO}:</p>`,
    `<p><a href="${url}">${url}</a></p>`,
    `<p>Oder auf ${escapeHtml(joinHost())} den Code <b>${escapeHtml(formatCode(code))}</b> eingeben.</p>`,
  ].join('');
}

/** In die Zwischenablage – formatiert, wo der Browser es kann, sonst als Text */
export async function copyInvitation(code: string | null, title?: string): Promise<void> {
  const text = invitationText(code, title);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([invitationHtml(code, title)], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // z. B. Firefox ohne text/html – dann reiner Text
    }
  }
  await navigator.clipboard.writeText(text);
}

export function InviteButton({ code, title }: { code: string | null; title?: string }) {
  const toast = useToast();
  return (
    <button
      className="icon-btn"
      disabled={!code}
      title="Einladung für den Chat (Teams, Zoom …) kopieren"
      aria-label="Einladung kopieren"
      onClick={async () => {
        try {
          await copyInvitation(code, title);
          toast('Einladung kopiert – im Chat (Teams, Zoom …) einfügen');
        } catch {
          toast('Kopieren nicht möglich', 'error');
        }
      }}
    >
      <MessageSquareShare />
    </button>
  );
}

/** Ist das Beamer-Fenster geöffnet und sichtbar? Verdeckte Fenster zeichnen Browser nicht neu. */
export function DisplayStatus({ displays }: { displays: HostView['displays'] | undefined }) {
  if (!displays || displays.connected === 0)
    return (
      <span className="pill" title="Kein Beamer-Fenster verbunden">
        <MonitorOff /> Beamer zu
      </span>
    );
  if (displays.hidden > 0)
    return (
      <span
        className="pill pill-warn"
        title="Das Beamer-Fenster ist verdeckt oder minimiert. Browser zeichnen verdeckte Fenster nicht neu – Beamer und Bildschirmfreigabe zeigen dann ein altes Bild."
        role="status"
      >
        <MonitorOff /> Beamer verdeckt
      </span>
    );
  return (
    <span
      className="pill pill-good"
      title={displays.connected === 1 ? 'Beamer-Fenster sichtbar' : `${displays.connected} Beamer-Fenster sichtbar`}
    >
      <Monitor /> Beamer sichtbar
    </span>
  );
}

/** Testteilnehmende im Probelauf: simuliertes Publikum an/aus, weitere anlegen, sofort antworten lassen, entfernen. */
export function RehearsalControls({ runId, view }: { runId: number; view: HostView }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [count, setCount] = useState(10);
  const [withAnswers, setWithAnswers] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async (body: { add: number; answer: boolean; simulate?: boolean }) => {
    setBusy(true);
    try {
      const res = await api<{ added: number; total: number; answered: number; note: string | null }>(`/api/runs/${runId}/rehearsal/fake`, {
        body,
      });
      const parts: string[] = [];
      if (body.simulate === true) parts.push(`Publikum simuliert – ${res.total} Testteilnehmende antworten nach und nach`);
      else if (res.added > 0) parts.push(`${res.added} Testteilnehmende hinzugefügt`);
      if (body.answer && res.answered > 0) parts.push(`${res.answered} Zufallsantworten`);
      if (res.note) parts.push(res.note);
      else if (body.answer && res.answered === 0) parts.push('Alle Testteilnehmenden haben hier schon geantwortet');
      if (body.simulate === false) parts.push('Simulation angehalten');
      toast(parts.join(' · ') || 'Erledigt', res.note && res.answered === 0 && res.added === 0 ? 'error' : 'info');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Alle Testteilnehmenden entfernen?',
      text: 'Ihre Antworten und Karten werden ebenfalls gelöscht.',
      confirmLabel: 'Entfernen',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/runs/${runId}/rehearsal/fake`, { method: 'DELETE' });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label
        className="switch small"
        title="Testteilnehmende antworten von selbst und zeitlich versetzt – wie ein echtes Publikum. Beim Einschalten ohne Testteilnehmende kommen 30–50 dazu."
      >
        <input
          type="checkbox"
          checked={view.simulating}
          disabled={busy}
          onChange={(e) => run({ add: 0, answer: false, simulate: e.target.checked })}
        />
        Publikum simulieren
      </label>
      <span className="row" style={{ gap: 6 }}>
        <input
          className="input minutes-input"
          type="number"
          min={1}
          max={50}
          value={count}
          aria-label="Anzahl Testteilnehmende"
          onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
        />
        <button className="btn btn-small" disabled={busy} onClick={() => run({ add: count, answer: withAnswers })}>
          <UserPlus /> Testteilnehmende hinzufügen
        </button>
      </span>
      <label className="switch small">
        <input type="checkbox" checked={withAnswers} onChange={(e) => setWithAnswers(e.target.checked)} />
        mit Antworten auf dieser Folie
      </label>
      {view.fakeParticipants > 0 && (
        <>
          <button
            className="btn btn-small"
            disabled={busy}
            onClick={() => run({ add: 0, answer: true })}
            title="Alle Testteilnehmenden, die noch nicht geantwortet haben, antworten sofort auf die aktuelle Folie"
          >
            <Shuffle /> Alle antworten jetzt ({view.fakeParticipants})
          </button>
          <button
            className="icon-btn"
            disabled={busy}
            onClick={remove}
            title="Testteilnehmende entfernen"
            aria-label="Testteilnehmende entfernen"
          >
            <Trash2 />
          </button>
        </>
      )}
    </>
  );
}

/** Probelauf beenden: standardmäßig gleich löschen, auf Wunsch behalten. */
export function EndRehearsalDialog({ onClose, onEnd }: { onClose: () => void; onEnd: (remove: boolean) => void }) {
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="end-rehearsal-title" onClick={onClose}>
      <div className="dialog card card-pad stack" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 id="end-rehearsal-title">Probelauf beenden</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <X />
          </button>
        </div>
        <p className="muted">
          Probeläufe erscheinen nicht als Durchführung im Archiv. Behältst du ihn, findest du ihn im Editor unter „Probeläufe“.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => onEnd(false)}>
            Beenden und behalten
          </button>
          <button className="btn btn-primary" autoFocus onClick={() => onEnd(true)}>
            <Trash2 /> Beenden und löschen
          </button>
        </div>
      </div>
    </div>
  );
}
