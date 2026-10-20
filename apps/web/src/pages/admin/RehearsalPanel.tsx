import type { HostView } from '@slides/shared';
import { FlaskConical, MessageSquareShare, Monitor, MonitorOff, Shuffle, Trash2, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { formatCode, joinUrl, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';

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

/** Text für den Chat einer Online-Sitzung: Link und Code */
export function invitationText(code: string | null): string {
  return `Macht mit: ${joinUrl(code)} – Code ${formatCode(code)}`;
}

export function InviteButton({ code }: { code: string | null }) {
  const toast = useToast();
  return (
    <button
      className="btn btn-small"
      disabled={!code}
      title="Einladung für den Chat (Teams, Zoom …) kopieren"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(invitationText(code));
          toast('Einladung kopiert – im Chat einfügen');
        } catch {
          toast('Kopieren nicht möglich', 'error');
        }
      }}
    >
      <MessageSquareShare /> <span>Einladung</span>
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

/** Testteilnehmende im Probelauf: anlegen, Zufallsantworten auf die aktuelle Folie, entfernen. */
export function RehearsalControls({ runId, view }: { runId: number; view: HostView }) {
  const toast = useToast();
  const [count, setCount] = useState(10);
  const [withAnswers, setWithAnswers] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async (body: { add: number; answer: boolean }) => {
    setBusy(true);
    try {
      const res = await api<{ added: number; total: number; answered: number; note: string | null }>(`/api/runs/${runId}/rehearsal/fake`, {
        body,
      });
      const parts: string[] = [];
      if (res.added > 0) parts.push(`${res.added} Testteilnehmende hinzugefügt`);
      if (body.answer && res.answered > 0) parts.push(`${res.answered} Zufallsantworten`);
      if (res.note) parts.push(res.note);
      else if (body.answer && res.answered === 0) parts.push('Alle Testteilnehmenden haben hier schon geantwortet');
      toast(parts.join(' · ') || 'Erledigt', res.note && res.answered === 0 && res.added === 0 ? 'error' : 'info');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Alle Testteilnehmenden samt ihrer Antworten und Karten entfernen?')) return;
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
            title="Alle Testteilnehmenden, die noch nicht geantwortet haben, antworten zufällig auf die aktuelle Folie"
          >
            <Shuffle /> Zufallsantworten ({view.fakeParticipants})
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
