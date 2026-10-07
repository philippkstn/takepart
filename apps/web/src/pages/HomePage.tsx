import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { LegalLinks } from '../components/LegalLinks.tsx';
import { Link, useNavigate } from 'react-router';
import { BrandMark } from '../components/ui.tsx';
import './participant.css';

/** Startseite für Teilnehmende: Code eingeben und los. */
export function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const digits = code.replace(/\D/g, '').slice(0, 6);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (digits.length === 6) navigate(`/${digits}`);
  };

  return (
    <div className="p-shell">
      <main className="p-main home">
        <div className="home-brand anim-rise">
          <BrandMark size={40} />
          <span className="display-font">TakePart</span>
        </div>
        <form className="card card-pad stack anim-rise" onSubmit={submit}>
          <div className="stack-s">
            <h1>Code eingeben</h1>
            <p className="muted">Den sechsstelligen Code findest du auf der Präsentation.</p>
          </div>
          <label className="visually-hidden" htmlFor="code">
            Code
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
      </main>
      <footer className="p-footer">
        <LegalLinks />
        <Link to="/login">Für Vortragende</Link>
      </footer>
    </div>
  );
}
