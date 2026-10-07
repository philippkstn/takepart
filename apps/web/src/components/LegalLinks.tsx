import { Heart } from 'lucide-react';
import type { ReactNode } from 'react';
import { usePublicConfig } from '../lib/publicConfig.ts';

/** Impressum, Datenschutz (falls konfiguriert) und Quellcode-Link (AGPL § 13). */
export function LegalLinks({ imprint = true }: { imprint?: boolean }) {
  const config = usePublicConfig();
  if (!config) return null;
  return (
    <>
      {imprint && config.imprintUrl && (
        <a href={config.imprintUrl} rel="noopener">
          Impressum
        </a>
      )}
      {config.privacyUrl && (
        <a href={config.privacyUrl} rel="noopener">
          Datenschutz
        </a>
      )}
      <a href={config.sourceUrl} rel="noopener">
        Quellcode
      </a>
    </>
  );
}

/** Fußzeile der Einstiegsseiten (Teilnahme und Anmeldung). */
export function SiteFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="p-footer site-footer">
      <p className="made-with">
        Made with <Heart className="made-with-heart" size={15} fill="currentColor" strokeWidth={0} role="img" aria-label="love" /> in
        Osnabrück
      </p>
      <nav className="p-footer-links" aria-label="Rechtliches">
        <LegalLinks />
        {children}
      </nav>
    </footer>
  );
}
