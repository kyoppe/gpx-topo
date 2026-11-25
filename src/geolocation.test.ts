import { describe, expect, it, vi } from 'vitest';

import { CurrentLocationError, requestCurrentLocation } from './geolocation';

function position(latitude: number, longitude: number) {
  return { coords: { latitude, longitude } } as GeolocationPosition;
}

describe('requestCurrentLocation', () => {
  it('resolves the coordinates returned by the browser', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(position(35.681236, 139.767125)));

    await expect(requestCurrentLocation({ getCurrentPosition })).resolves.toEqual({ lat: 35.681236, lon: 139.767125 });
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10_000,
    });
  });

  it('reports a permission denial without throwing from the callback', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) =>
      error({ code: 1, message: 'denied' } as GeolocationPositionError),
    );

    await expect(requestCurrentLocation({ getCurrentPosition })).rejects.toMatchObject({
      kind: 'permission-denied',
    });
  });

  it.each([
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const)('classifies browser error code %s as %s', async (code, kind) => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) =>
      error({ code, message: kind } as GeolocationPositionError),
    );

    await expect(requestCurrentLocation({ getCurrentPosition })).rejects.toMatchObject({ kind });
  });

  it('starts a fresh request when the user asks again', async () => {
    const positions = [position(35, 139), position(36, 140)];
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(positions.shift() as GeolocationPosition));

    await expect(requestCurrentLocation({ getCurrentPosition })).resolves.toEqual({ lat: 35, lon: 139 });
    await expect(requestCurrentLocation({ getCurrentPosition })).resolves.toEqual({ lat: 36, lon: 140 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('rejects when geolocation is unavailable', async () => {
    await expect(requestCurrentLocation(undefined)).rejects.toEqual(new CurrentLocationError('unsupported'));
  });
});
