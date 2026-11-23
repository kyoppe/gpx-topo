export type FrameRateChange = {
  fps: number;
  reason: 'slow' | 'recovered';
};

type FrameRateOptions = {
  highFps: number;
  lowFps: number;
  slowFrameMs?: number;
  recoverFrameMs?: number;
  slowSamples?: number;
  recoverSamples?: number;
  scheduleLeadMs?: number;
};

export function createAdaptiveFrameRate({
  highFps,
  lowFps,
  slowFrameMs = 26,
  recoverFrameMs = 18,
  slowSamples: slowSampleLimit = 3,
  recoverSamples: recoverSampleLimit = 20,
  scheduleLeadMs = 3,
}: FrameRateOptions) {
  let fps = highFps;
  let slowSamples = 0;
  let recoverSamples = 0;

  return {
    get fps() {
      return fps;
    },
    frameDelayMs(elapsedSincePaintMs: number) {
      return Math.max(0, 1000 / fps - Math.max(0, elapsedSincePaintMs) - scheduleLeadMs);
    },
    observe(frameWorkMs: number): FrameRateChange | null {
      if (frameWorkMs > slowFrameMs) {
        slowSamples += 1;
        recoverSamples = 0;
      } else if (frameWorkMs < recoverFrameMs) {
        recoverSamples += 1;
        slowSamples = 0;
      } else {
        slowSamples = Math.max(0, slowSamples - 1);
        recoverSamples = 0;
      }

      if (fps === highFps && slowSamples >= slowSampleLimit) {
        fps = lowFps;
        slowSamples = 0;
        return { fps, reason: 'slow' };
      }
      if (fps === lowFps && recoverSamples >= recoverSampleLimit) {
        fps = highFps;
        recoverSamples = 0;
        return { fps, reason: 'recovered' };
      }
      return null;
    },
  };
}
