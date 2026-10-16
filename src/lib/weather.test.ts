import { describe, expect, it } from 'vitest';
import {
  FORECAST_FORMAT,
  isWetStreet,
  motifWindows,
  wetStreetAt,
  buildForecastUrl,
  classifyClouds,
  describeClouds,
  hoursBetween,
  locationKey,
  needsRefresh,
  parseForecastResponse,
  uniqueLocations,
  WeatherError,
  weatherAt,
  type Forecast,
  type HourWeather,
} from './weather';

const T0 = Date.UTC(2026, 9, 16, 0, 0, 0) / 1000;

function apiLocation(hours: number, patch: Record<string, unknown[]> = {}) {
  const time = Array.from({ length: hours }, (_, i) => T0 + i * 3600);
  const fill = (v: number) => time.map(() => v);
  return {
    latitude: 46.94,
    longitude: 7.44,
    hourly: {
      time,
      cloud_cover: fill(30),
      cloud_cover_low: fill(10),
      cloud_cover_mid: fill(20),
      cloud_cover_high: fill(40),
      precipitation: fill(0),
      visibility: fill(24000),
      relative_humidity_2m: fill(70),
      wind_gusts_10m: fill(20),
      ...patch,
    },
  };
}

const hour = (low: number | null, mid: number | null, high: number | null): HourWeather => ({
  time: 0,
  cloudCover: null,
  cloudLow: low,
  cloudMid: mid,
  cloudHigh: high,
  precipitation: null,
  visibility: null,
  humidity: null,
  windGusts: null,
});

describe('locations and URL', () => {
  it('merges spots within the same 0.01° cell', () => {
    const locs = uniqueLocations([
      { lat: 46.9481, lon: 7.4474 },
      { lat: 46.9479, lon: 7.4471 },
      { lat: 47.3769, lon: 8.5417 },
    ]);
    expect(locs.map((l) => l.key)).toEqual(['46.95,7.45', '47.38,8.54']);
  });

  it('builds one request for all locations', () => {
    const url = new URL(buildForecastUrl(uniqueLocations([{ lat: 46.948, lon: 7.447 }, { lat: 47.377, lon: 8.542 }])));
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.searchParams.get('latitude')).toBe('46.95,47.38');
    expect(url.searchParams.get('longitude')).toBe('7.45,8.54');
    expect(url.searchParams.get('hourly')).toContain('cloud_cover_low');
    expect(url.searchParams.get('forecast_days')).toBe('5');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
  });
});

describe('parseForecastResponse', () => {
  const one = uniqueLocations([{ lat: 46.948, lon: 7.447 }]);
  const two = uniqueLocations([{ lat: 46.948, lon: 7.447 }, { lat: 47.377, lon: 8.542 }]);

  it('accepts a single-location object', () => {
    const r = parseForecastResponse(apiLocation(3), one);
    expect(r[one[0].key]).toHaveLength(3);
    expect(r[one[0].key][1]).toMatchObject({ time: (T0 + 3600) * 1000, cloudLow: 10, visibility: 24000 });
  });

  it('maps an array by request order', () => {
    const r = parseForecastResponse([apiLocation(2), apiLocation(4)], two);
    expect(r[two[0].key]).toHaveLength(2);
    expect(r[two[1].key]).toHaveLength(4);
  });

  it('nulls out-of-range or missing values and skips bad times', () => {
    const raw = apiLocation(3, { cloud_cover_low: [10, 150, 'x'], time: [T0, 'bad', T0 + 7200] });
    delete (raw.hourly as Record<string, unknown>).visibility;
    const hours = parseForecastResponse(raw, one)[one[0].key];
    expect(hours.map((h) => h.cloudLow)).toEqual([10, null]);
    expect(hours.every((h) => h.visibility === null)).toBe(true);
  });

  it('rejects structurally wrong responses', () => {
    expect(() => parseForecastResponse(null, one)).toThrow(WeatherError);
    expect(() => parseForecastResponse({ hourly: {} }, one)).toThrow(WeatherError);
    expect(() => parseForecastResponse([apiLocation(1)], two)).toThrow('passen nicht');
    expect(() => parseForecastResponse({ error: true, reason: 'Latitude must be in range' }, one)).toThrow('Open-Meteo: Latitude');
  });
});

describe('classifyClouds', () => {
  it('classifies at the thresholds', () => {
    expect(classifyClouds(hour(0, 0, 0))).toBe('hard');
    expect(classifyClouds(hour(19, 29, 69))).toBe('hard');
    expect(classifyClouds(hour(20, 0, 0))).toBe('mixed');
    expect(classifyClouds(hour(0, 30, 0))).toBe('mixed');
    expect(classifyClouds(hour(0, 0, 70))).toBe('mixed');
    expect(classifyClouds(hour(70, 0, 0))).toBe('soft');
    expect(classifyClouds(hour(0, 80, 0))).toBe('soft');
    expect(classifyClouds(hour(null, 0, 0))).toBeNull();
  });

  it('describes an hour', () => {
    expect(describeClouds(hour(5, 10, 40.4))).toBe('hart · Wolken T/M/H 5/10/40 %');
  });
});

describe('weatherAt / hoursBetween', () => {
  const hours = parseForecastResponse(apiLocation(4), uniqueLocations([{ lat: 1, lon: 1 }]))[locationKey(1, 1)];

  it('picks the nearest hour within 90 min', () => {
    expect(weatherAt(hours, new Date((T0 + 3600 + 1700) * 1000))?.time).toBe((T0 + 3600) * 1000);
    expect(weatherAt(hours, new Date((T0 + 3 * 3600 + 89 * 60) * 1000))).not.toBeNull();
    expect(weatherAt(hours, new Date((T0 + 3 * 3600 + 91 * 60) * 1000))).toBeNull();
    expect(weatherAt(undefined, new Date())).toBeNull();
  });

  it('returns hours overlapping a range', () => {
    const r = hoursBetween(hours, new Date((T0 + 1800) * 1000), new Date((T0 + 2 * 3600) * 1000));
    expect(r.map((h) => (h.time / 1000 - T0) / 3600)).toEqual([0, 1]);
  });
});

describe('needsRefresh', () => {
  const locs = uniqueLocations([{ lat: 46.948, lon: 7.447 }]);
  const now = new Date('2026-10-16T10:00:00Z');
  const forecast = (fetchedAt: string, keys = locs.map((l) => l.key)): Forecast => ({
    format: FORECAST_FORMAT,
    fetchedAt,
    locations: Object.fromEntries(keys.map((k) => [k, []])),
  });

  it('is false without spots', () => {
    expect(needsRefresh(null, [], now)).toBe(false);
  });
  it('is true without forecast, when stale, from the future, or when a location is missing', () => {
    expect(needsRefresh(null, locs, now)).toBe(true);
    expect(needsRefresh(forecast('2026-10-16T08:59:00Z'), locs, now)).toBe(true);
    expect(needsRefresh(forecast('2026-10-16T11:00:00Z'), locs, now)).toBe(true);
    expect(needsRefresh(forecast('2026-10-16T09:30:00Z', []), locs, now)).toBe(true);
  });
  it('is false for a fresh, complete forecast', () => {
    expect(needsRefresh(forecast('2026-10-16T09:30:00Z'), locs, now)).toBe(false);
  });
  it('is true for a fresh forecast in an older format', () => {
    const { format: _format, ...old } = forecast('2026-10-16T09:30:00Z');
    expect(needsRefresh(old, locs, now)).toBe(true);
  });
});

const H = 3600 * 1000;
const series = (precip: (number | null)[], gusts: (number | null)[] = []): HourWeather[] =>
  precip.map((p, i) => ({ ...hour(10, 10, 10), time: i * H, precipitation: p, windGusts: gusts[i] ?? null }));

describe('isWetStreet (F8)', () => {
  it('needs ≥ 0.3 mm in the 3 hours before and < 0.1 mm now', () => {
    const hs = series([0.1, 0.1, 0.1, 0, 0.05, 0.1]);
    expect(isWetStreet(hs, 3)).toBe(true);
    expect(isWetStreet(hs, 4)).toBe(false); // 0.1 + 0.1 + 0 = 0.2
    expect(isWetStreet(hs, 5)).toBe(false); // raining 0.1 now
  });
  it('is false at the start of the forecast, with gaps or missing values', () => {
    expect(isWetStreet(series([1, 1, 0]), 2)).toBe(false);
    const gap = series([1, 1, 1, 0]);
    gap[0] = { ...gap[0], time: -5 * H };
    expect(isWetStreet(gap, 3)).toBe(false);
    expect(isWetStreet(series([1, null, 1, 0]), 3)).toBe(false);
  });
  it('looks up the nearest hour', () => {
    const hs = series([0.2, 0.2, 0.2, 0]);
    expect(wetStreetAt(hs, new Date(3 * H - 20 * 60 * 1000))).toBe(true);
    expect(wetStreetAt(hs, new Date(1 * H))).toBe(false);
    expect(wetStreetAt(undefined, new Date())).toBe(false);
  });
});

describe('motifWindows (F10)', () => {
  it('merges consecutive rainy and windy hours, covering the preceding hour', () => {
    const hs = series([0, 0.6, 1.8, 0.2, 0.7], [10, 45, 55, 30, 20]);
    const m = motifWindows(hs);
    expect(m.map((x) => [x.kind, x.start.getTime() / H, x.end.getTime() / H, x.peak])).toEqual([
      ['rain', 0, 2, 1.8],
      ['wind', 0, 2, 55],
      ['rain', 3, 4, 0.7],
    ]);
  });
  it('ignores missing values', () => {
    expect(motifWindows(series([null, null], [null, null]))).toEqual([]);
  });
});
