import { ABOUT, type AboutFeature } from '@slides/shared/about';
import { ArrowRight, BarChart3, MessageCircleQuestion, Presentation, StickyNote, Trophy, Users, type LucideIcon } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { SiteFooter } from '../components/LegalLinks.tsx';
import { BarList } from '../components/Results.tsx';
import { BrandMark } from '../components/ui.tsx';
import { AnimatedNumber } from '../lib/liveMotion.tsx';
import { usePublicConfig } from '../lib/publicConfig.ts';
import './participant.css';

const FEATURE_ICONS: Record<AboutFeature['id'], LucideIcon> = {
  vote: BarChart3,
  qa: MessageCircleQuestion,
  quiz: Trophy,
  board: StickyNote,
  teams: Users,
  import: Presentation,
};

/**
 * Startseite: oben der Beitritt per Code (Hauptaufgabe) neben einer Vorschau der
 * Bühne, darunter kurz erklärt, wie es läuft und was geht (Texte: shared/about.ts,
 * dieselben stehen im ausgelieferten HTML, siehe server/seo.ts).
 */
export function HomePage() {
  const navigate = useNavigate();
  const config = usePublicConfig();
  const [code, setCode] = useState('');
  const digits = code.replace(/\D/g, '').slice(0, 6);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (digits.length === 6) navigate(`/${digits}`);
  };

  return (
    <div className="p-shell takepart-scope home-page">
      <header className="home-top">
        <span className="home-brand">
          <BrandMark size={32} />
          <span className="display-font">TakePart</span>
        </span>
        <Link className="home-top-link" to="/login">
          Für Vortragende
        </Link>
      </header>

      <main className="home-hero">
        <div className="home-join anim-rise">
          <h1 className="home-title">{ABOUT.tagline}</h1>
          <p className="home-lead">Code von der Präsentation eingeben und mitmachen – ohne Konto, ohne App.</p>
          <form className="card card-pad stack home-form" onSubmit={submit}>
            <label className="label" htmlFor="code">
              Sechsstelliger Code
            </label>
            <input
              id="code"
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              value={digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <button className="btn btn-primary btn-large btn-block" disabled={digits.length !== 6}>
              Beitreten <ArrowRight />
            </button>
          </form>
        </div>
        <StagePreview />
      </main>

      <section className="home-section" aria-labelledby="home-steps">
        <h2 id="home-steps">So läuft’s</h2>
        <ol className="home-steps">
          {ABOUT.steps.map((s, i) => (
            <li key={s.title}>
              <span className="home-step-no tabular" aria-hidden>
                {i + 1}
              </span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-section" aria-labelledby="home-features">
        <h2 id="home-features">Was alles geht</h2>
        <ul className="home-features">
          {ABOUT.features.map((f) => {
            const Icon = FEATURE_ICONS[f.id];
            return (
              <li key={f.id}>
                <Icon className="home-feature-icon" aria-hidden />
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="home-section home-presenters" aria-labelledby="home-presenters">
        <h2 id="home-presenters">Für Vortragende</h2>
        <div className="home-presenter-text">
          <p>{ABOUT.presenters}</p>
          <p className="muted">{ABOUT.selfHosting}</p>
        </div>
        <div className="home-presenter-actions">
          <Link className="btn" to="/login">
            Anmelden
          </Link>
          {config && (
            <a className="btn btn-ghost" href={config.sourceUrl} rel="noopener">
              Quellcode
            </a>
          )}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/** Endstand der Beispiel-Abstimmung; die Stimmen laufen beim Laden einmal ein. */
const PREVIEW_OPTIONS = ['Am Handy', 'Am Laptop', 'Am Tablet'];
const PREVIEW_FINAL = [18, 11, 4];
const PREVIEW_STEPS = 8;

/**
 * Wie die Bühne auf dem Beamer aussieht: eine Abstimmung, in die gerade Stimmen
 * kommen (dieselben Balken und Animationen wie im Vortrag). Spielt einmal und
 * bleibt dann stehen; ohne Bewegung sofort der Endstand.
 */
function StagePreview() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(reduce ? PREVIEW_STEPS : 2);
  useEffect(() => {
    if (reduce || step >= PREVIEW_STEPS) return;
    const timer = setTimeout(() => setStep((s) => s + 1), 380);
    return () => clearTimeout(timer);
  }, [step, reduce]);
  const counts = PREVIEW_FINAL.map((n) => Math.round((n * step) / PREVIEW_STEPS));
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);
  return (
    <figure className="home-preview anim-rise" aria-label="Beispiel: eine Abstimmung auf der Bühne mit Live-Ergebnis">
      <div className="home-stage" aria-hidden>
        <p className="home-stage-q">Wie bist du heute dabei?</p>
        <BarList
          max={max}
          items={PREVIEW_OPTIONS.map((label, i) => ({
            key: i,
            label,
            value: counts[i]!,
            display: String(counts[i]),
          }))}
        />
        <div className="home-stage-foot">
          <span>
            <AnimatedNumber className="tabular" value={total} /> Antworten
          </span>
          <span>
            Code <strong className="tabular">482 913</strong>
          </span>
        </div>
      </div>
    </figure>
  );
}
