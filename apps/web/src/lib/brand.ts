import type { BrandView } from '@slides/shared';
import type { CSSProperties } from 'react';

/** Relative Leuchtdichte nach WCAG */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

/** Weiß oder Tinte – je nachdem, was auf der Farbe besser lesbar ist. */
export function readableOn(hex: string): string {
  return contrast(hex, '#ffffff') >= contrast(hex, '#18181a') ? '#ffffff' : '#18181a';
}

/**
 * CSS-Variablen für ein Branding. Ohne Branding `undefined` – dann gelten die
 * neutralen Standardfarben aus index.css. Abgeleitete Töne werden hier gesetzt,
 * weil Custom Properties dort aufgelöst werden, wo sie deklariert sind.
 */
export function brandStyle(brand: BrandView | null | undefined): CSSProperties | undefined {
  if (!brand) return undefined;
  const ink = readableOn(brand.accent);
  const hover = `color-mix(in srgb, ${brand.accent} 85%, #000000)`;
  return {
    '--accent': brand.accent,
    '--accent-hover': hover,
    '--accent-ink': ink,
    '--accent-soft': `color-mix(in srgb, ${brand.accent} 10%, var(--surface))`,
    '--primary': brand.accent,
    '--primary-hover': hover,
    '--primary-ink': ink,
    '--chart': brand.chart,
  } as CSSProperties;
}
