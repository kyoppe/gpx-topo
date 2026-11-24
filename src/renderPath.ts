/**
 * Which way the page reaches the screen.
 * - `native`: HTML-in-Canvas, the original path. Chosen whenever the browser supports it.
 * - `fallback`: DOM pieces are rasterized with the 2D canvas and uploaded as ordinary textures.
 * - `unsupported`: no HTML-in-Canvas and the fallback is not switched on; the notice screen is shown.
 */
export type RenderPath = 'native' | 'fallback' | 'unsupported';

/** Until the fallback UI is complete it is only on in dev builds, or when VITE_ENABLE_FALLBACK=true. */
export function fallbackEnabled() {
  return import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_FALLBACK === 'true';
}

/** Support always wins: a browser with HTML-in-Canvas never leaves the native path. */
export function resolveRenderPath(supported: boolean, enabled: boolean): RenderPath {
  if (supported) return 'native';
  return enabled ? 'fallback' : 'unsupported';
}
