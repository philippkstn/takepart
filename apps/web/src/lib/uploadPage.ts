import type { RenderedPage } from './importDeck.ts';

async function send(path: string, body: Blob | string, method: string, type: string) {
  const res = await fetch(path, { method, headers: { 'Content-Type': type }, body, credentials: 'same-origin' });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Upload fehlgeschlagen (${res.status})`);
  }
  return res.json() as Promise<unknown>;
}

/**
 * Gerenderte PDF-Seite hochladen: Bild, Miniatur, Druckbild in doppelter
 * Auflösung und Textebene. Liefert die Kennung des neuen Bilds.
 */
export async function uploadPage(presentationId: number, page: RenderedPage): Promise<string> {
  const { asset } = (await send(
    `/api/presentations/${presentationId}/assets?width=${page.width}&height=${page.height}`,
    page.full,
    'POST',
    page.full.type,
  )) as { asset: string };
  await Promise.all([
    send(`/api/assets/${asset}/thumb`, page.thumb, 'PUT', page.thumb.type),
    send(`/api/assets/${asset}/hires`, page.hires, 'PUT', page.hires.type),
    page.text.length > 0 ? send(`/api/assets/${asset}/text`, JSON.stringify({ runs: page.text }), 'PUT', 'application/json') : null,
  ]);
  return asset;
}
