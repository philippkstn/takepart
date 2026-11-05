import { assetUrl, fitBuildBox, type BuildsConfig, type Slide } from '@slides/shared';

type ImageSlide = Extract<Slide, { type: 'image' }>;

/** Bildfolien mit Animationen, deren Abdeckungen noch nicht am Folienbild angepasst sind */
export const needsRefit = (slide: Slide): slide is ImageSlide =>
  slide.type === 'image' && !!slide.config.builds && slide.config.builds.regions.length > 0 && !slide.config.builds.fitted;

/**
 * Abdeckungen einer schon importierten Folie nachträglich an das gespeicherte
 * Folienbild anpassen (wie beim Import, nur auf dem komprimierten Bild – die
 * Tinten-Schwelle liegt weit über den Kompressionsartefakten). Die gemessenen
 * Farben bleiben: Sie stammen aus dem unkomprimierten Bild und sind genauer.
 */
export async function refitBuilds(slide: ImageSlide): Promise<BuildsConfig> {
  const builds = slide.config.builds!;
  const img = new Image();
  img.src = assetUrl(slide.config.asset);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const regions = builds.regions.map((r) => ({ ...r, ...fitBuildBox(data, r).box }));
  return { ...builds, regions, fitted: true };
}
