// How hard the fallback render path should work on a given device (the engine's `maxPixelRatio` and `maxFps`).

/** Phones and tablets: a screen with 3x the pixels of a desktop one, a GPU that cannot fill them at 60 fps. */
export const TOUCH_PIXEL_RATIO = 1.5;

export function fallbackPerformance(coarsePointer: boolean) {
  return coarsePointer ? { maxPixelRatio: TOUCH_PIXEL_RATIO, maxFps: 60 } : { maxPixelRatio: 2, maxFps: 60 };
}

/** Reads the device from the window: a coarse pointer (a finger) is a touch device. */
export function fallbackPerformanceFor(win: Pick<Window, 'matchMedia'>) {
  return fallbackPerformance(typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches);
}
