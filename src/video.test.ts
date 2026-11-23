import { describe, expect, it } from 'vitest';

import { MAX_VIDEO_RECORDING_MS, VIDEO_RECORDING_FRAME_RATE, supportedVideoMimeType, videoFileName } from './video';

describe('video recording helpers', () => {
  it('uses a 30 fps stream with a 90 second limit', () => {
    expect(VIDEO_RECORDING_FRAME_RATE).toBe(30);
    expect(MAX_VIDEO_RECORDING_MS).toBe(90_000);
  });

  it('prefers MP4 and falls back to WebM', () => {
    expect(supportedVideoMimeType((mimeType) => mimeType.startsWith('video/mp4'))).toBe('video/mp4;codecs=avc1.42E01E');
    expect(supportedVideoMimeType((mimeType) => mimeType.includes('vp8'))).toBe('video/webm;codecs=vp8');
    expect(supportedVideoMimeType(() => false)).toBe('');
  });

  it('creates a timestamped filename shared by GPX and Map modes', () => {
    const timestamp = new Date(2026, 10, 23, 16, 20, 5);
    expect(videoFileName('video/mp4', timestamp)).toBe('gpx-topo-20261123-162005.mp4');
    expect(videoFileName('video/webm', timestamp)).toBe('gpx-topo-20261123-162005.webm');
  });
});
