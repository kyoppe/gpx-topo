export type CurrentLocation = {
  lat: number;
  lon: number;
};

export type CurrentLocationErrorKind = 'unsupported' | 'permission-denied' | 'unavailable' | 'timeout' | 'unknown';

export class CurrentLocationError extends Error {
  readonly kind: CurrentLocationErrorKind;

  constructor(kind: CurrentLocationErrorKind) {
    super(kind);
    this.name = 'CurrentLocationError';
    this.kind = kind;
  }
}

function errorKind(code: number): CurrentLocationErrorKind {
  if (code === 1) return 'permission-denied';
  if (code === 2) return 'unavailable';
  if (code === 3) return 'timeout';
  return 'unknown';
}

const DEFAULT_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10_000,
};

export function requestCurrentLocation(
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined,
  options: PositionOptions = DEFAULT_OPTIONS,
): Promise<CurrentLocation> {
  if (!geolocation) return Promise.reject(new CurrentLocationError('unsupported'));

  return new Promise((resolve, reject) => {
    try {
      geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            reject(new CurrentLocationError('unknown'));
            return;
          }
          resolve({ lat: latitude, lon: longitude });
        },
        (error) => reject(new CurrentLocationError(errorKind(error.code))),
        options,
      );
    } catch {
      reject(new CurrentLocationError('unknown'));
    }
  });
}
