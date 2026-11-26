export class ApiError extends Error {
  status: number;
  /** Vollständige Antwort (z. B. aktueller Stand bei einem Konflikt, 409) */
  data: unknown;
  constructor(status: number, message: string, data: unknown = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * Kennung dieses Browser-Tabs fürs gemeinsame Bearbeiten: geht bei jedem Aufruf
 * mit, damit der Editor eigene Änderungen am Änderungshinweis erkennt.
 */
export const editClientId = (() => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
})();

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; participant?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.participant) headers['X-Participant'] = options.participant;
  else headers['X-Edit-Client'] = editClientId;
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung – bitte gleich noch einmal versuchen');
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Fehler ${res.status}`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Unbekannter Fehler');
