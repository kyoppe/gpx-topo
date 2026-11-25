// Sharing a photo or a video through the phone's own share sheet.
//
// The sheet is what puts a file in Photos ("Save Image" / "Save Video") or hands it to another app such as X. A plain
// download would land in Files on an iPhone, so the fallback offers the sheet wherever the browser has one.

/** The type of a recording without its codecs (`video/mp4;codecs=avc1` -> `video/mp4`): that is what a share sheet looks at. */
export function plainMimeType(type: string, fallback: string): string {
  return type.split(';')[0].trim() || fallback;
}

/** Whether this browser's share sheet takes the file. */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet with the file. Resolves `shared` once it was sent on, `cancelled` when the sheet was put away
 * without choosing (nothing went wrong), and `unsupported` when there is no sheet for this file. Any other failure throws.
 * Must be called from a tap: a browser opens its share sheet only for one.
 */
export async function shareFile(file: File, text: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFile(file)) return 'unsupported';
  try {
    await navigator.share({ files: [file], text });
    return 'shared';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    throw error;
  }
}

/**
 * Which buttons a made photo or video gets.
 * - `both`: one button that opens the share sheet. A phone's sheet has Save Image / Save Video (Photos) in it.
 * - `split`: a Share and a Save button. A desktop's sheet (the Mac's, say) has no way to save, so saving is its own key.
 * - `save`: no share sheet to offer; the file is downloaded.
 */
export type MediaActions = 'both' | 'split' | 'save';

export function mediaActions(shareable: boolean, touch: boolean): MediaActions {
  if (!shareable) return 'save';
  return touch ? 'both' : 'split';
}

/** A finger is this device's pointer (a phone or a tablet) rather than a mouse. */
export function isTouchDevice(win: Pick<Window, 'matchMedia'>): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
}
