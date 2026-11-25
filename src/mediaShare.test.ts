import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCopy } from './i18n';
import { canShareFile, isTouchDevice, mediaActions, plainMimeType, saveFailureMessage, shareFile } from './mediaShare';

const file = new File(['x'], 'gpx-topo.png', { type: 'image/png' });

function stubShare(share: unknown, canShare: unknown) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
}

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).share;
  delete (navigator as unknown as Record<string, unknown>).canShare;
});

describe('plainMimeType', () => {
  it('drops the codecs a recorder adds', () => {
    expect(plainMimeType('video/mp4;codecs=avc1.42E01E', 'video/mp4')).toBe('video/mp4');
    expect(plainMimeType('video/webm; codecs=vp9', 'video/mp4')).toBe('video/webm');
  });

  it('keeps a plain type, and falls back when there is none', () => {
    expect(plainMimeType('image/png', 'image/png')).toBe('image/png');
    expect(plainMimeType('', 'video/mp4')).toBe('video/mp4');
  });
});

describe('canShareFile', () => {
  it('is false where the browser has no share sheet', () => {
    expect(canShareFile(file)).toBe(false);
  });

  it('is false when the sheet cannot take files', () => {
    stubShare(vi.fn(), vi.fn(() => false));
    expect(canShareFile(file)).toBe(false);
  });

  it('is false when there is a share but no way to ask about files', () => {
    stubShare(vi.fn(), undefined);
    expect(canShareFile(file)).toBe(false);
  });

  it('is true when the sheet takes the file', () => {
    const canShare = vi.fn(() => true);
    stubShare(vi.fn(), canShare);
    expect(canShareFile(file)).toBe(true);
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
  });
});

describe('shareFile', () => {
  it('reports unsupported without opening anything', async () => {
    const share = vi.fn();
    stubShare(share, vi.fn(() => false));
    await expect(shareFile(file, 'text')).resolves.toBe('unsupported');
    expect(share).not.toHaveBeenCalled();
  });

  it('hands the file and the text to the sheet', async () => {
    const share = vi.fn(async () => undefined);
    stubShare(share, vi.fn(() => true));
    await expect(shareFile(file, 'made with it')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file], text: 'made with it' });
  });

  it('treats a sheet put away without choosing as nothing wrong', async () => {
    stubShare(
      vi.fn(async () => {
        throw new DOMException('cancelled', 'AbortError');
      }),
      vi.fn(() => true),
    );
    await expect(shareFile(file, 'text')).resolves.toBe('cancelled');
  });

  it('lets any other failure through', async () => {
    stubShare(
      vi.fn(async () => {
        throw new DOMException('not allowed', 'NotAllowedError');
      }),
      vi.fn(() => true),
    );
    await expect(shareFile(file, 'text')).rejects.toThrow('not allowed');
  });
});

describe('mediaActions', () => {
  it('offers only a download where there is no share sheet', () => {
    expect(mediaActions(false, true)).toBe('save');
    expect(mediaActions(false, false)).toBe('save');
  });

  it('gives a phone one button, for its sheet can save to Photos', () => {
    expect(mediaActions(true, true)).toBe('both');
  });

  it('gives a desktop two, for its sheet cannot save', () => {
    expect(mediaActions(true, false)).toBe('split');
  });
});

describe('isTouchDevice', () => {
  it('reads a coarse pointer as a finger', () => {
    expect(isTouchDevice({ matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }) as MediaQueryList })).toBe(true);
    expect(isTouchDevice({ matchMedia: () => ({ matches: false }) as MediaQueryList })).toBe(false);
  });

  it('is not touch where matchMedia is missing', () => {
    expect(isTouchDevice({} as Pick<Window, 'matchMedia'>)).toBe(false);
  });
});

describe('saveFailureMessage', () => {
  it.each(['en', 'ja'] as const)('tells a video that was made but not saved from a recording that failed (%s)', (lang) => {
    const { toast } = getCopy(lang);
    expect(saveFailureMessage('photo', toast)).toBe(toast.imageSavedFailed);
    expect(saveFailureMessage('video', toast)).toBe(toast.videoSavedFailed);
    expect(saveFailureMessage('video', toast)).not.toBe(toast.videoRecordingFailed);
  });
});
