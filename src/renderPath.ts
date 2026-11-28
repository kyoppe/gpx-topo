/**
 * Which way the page reaches the screen.
 * - `native`: HTML-in-Canvas, the original path. Chosen whenever the browser supports it.
 * - `fallback`: DOM pieces are rasterized with the 2D canvas and uploaded as ordinary textures.
 * - `unsupported`: no HTML-in-Canvas and fallback unavailable; the notice screen is shown.
 */
export type RenderPath = 'native' | 'fallback' | 'unsupported';

/** The fallback UI is production-ready, so it is available in every build. */
export function fallbackEnabled() {
  return true;
}

/** Support always wins: a browser with HTML-in-Canvas never leaves the native path. */
export function resolveRenderPath(supported: boolean, enabled: boolean): RenderPath {
  if (supported) return 'native';
  return enabled ? 'fallback' : 'unsupported';
}
