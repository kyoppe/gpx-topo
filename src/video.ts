export const MAX_VIDEO_RECORDING_MS = 90_000;
export const VIDEO_RECORDING_FRAME_RATE = 30;

const VIDEO_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

export function supportedVideoMimeType(isSupported: (mimeType: string) => boolean): string {
  return VIDEO_MIME_TYPES.find((mimeType) => isSupported(mimeType)) ?? '';
}

export function videoFileName(mimeType = 'video/webm', timestamp = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = [
    timestamp.getFullYear(),
    pad(timestamp.getMonth() + 1),
    pad(timestamp.getDate()),
  ].join('') + `-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}${pad(timestamp.getSeconds())}`;
  const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  return `gpx-topo-${stamp}.${extension}`;
}
