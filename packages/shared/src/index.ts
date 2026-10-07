import { z } from 'zod';

// Validierungsmeldungen auf Deutsch – sie erscheinen direkt in der Oberfläche.
z.config(z.locales.de());

export * from './slides.ts';
export * from './responses.ts';
export * from './results.ts';
export * from './state.ts';
export * from './words.ts';
export * from './deck.ts';
