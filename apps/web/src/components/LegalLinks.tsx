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
