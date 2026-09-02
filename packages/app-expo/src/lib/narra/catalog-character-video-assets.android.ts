/**
 * Android keeps the static bundled portrait as its offline fallback.
 *
 * Keeping this platform override empty prevents Metro from following the 93
 * static MP4 requires in catalog-character-video-assets.ts for Android builds.
 */
export const CATALOG_CHARACTER_VIDEO_ASSETS: Readonly<Record<string, number>> = Object.freeze({});
