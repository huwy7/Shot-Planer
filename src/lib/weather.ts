// Open-Meteo forecast: request building, untrusted-response parsing, cloud classification, cache freshness.

export const FORECAST_DAYS = 5;
export const MAX_FORECAST_AGE_MS = 60 * 60 * 1000; // SPEC N3
const HOUR_MS = 3600 * 1000;
/** A forecast hour is used for times at most this far away. */
const MAX_HOUR_DISTANCE_MS = 90 * 60 * 1000;

/** Hourly variables; precipitation, visibility and humidity are kept for v1.1/v1.2 (F8, F9). */
export const HOURLY_VARS = [
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'precipitation',
  'visibility',
  'relative_humidity_2m',
] as const;

export interface HourWeather {
  /** Start of the hour, ms since epoch (UTC). */
  time: number;
  cloudCover: number | null;
  cloudLow: number | null;
  cloudMid: number | null;
  cloudHigh: number | null;
  /** mm in the preceding hour. */
  precipitation: number | null;
  /** Meters. */
  visibility: number | null;
  /** Percent. */
  humidity: number | null;
}

export interface Forecast {
  fetchedAt: string;
  /** Hours per location key (see `locationKey`). */
  locations: Record<string, HourWeather[]>;
}

export interface WeatherLocation {
  key: string;
  lat: number;
  lon: number;
}

export class WeatherError extends Error {}

/** Spots within ~1 km share a forecast; the models are not finer than that anyway. */
export function locationKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export function uniqueLocations(points: readonly { lat: number; lon: number }[]): WeatherLocation[] {
  const byKey = new Map<string, WeatherLocation>();
  for (const p of points) {
    const key = locationKey(p.lat, p.lon);
    if (!byKey.has(key)) byKey.set(key, { key, lat: Number(p.lat.toFixed(2)), lon: Number(p.lon.toFixed(2)) });
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function buildForecastUrl(locations: readonly WeatherLocation[]): string {
  const params = new URLSearchParams({
    latitude: locations.map((l) => l.lat.toFixed(2)).join(','),
    longitude: locations.map((l) => l.lon.toFixed(2)).join(','),
    hourly: HOURLY_VARS.join(','),
    forecast_days: String(FORECAST_DAYS),
    timeformat: 'unixtime',
    timezone: 'GMT',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

const inRange = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

function parseLocation(raw: unknown): HourWeather[] {
  if (typeof raw !== 'object' || raw === null) throw new WeatherError('Ungültige Wetterdaten.');
  const hourly = (raw as Record<string, unknown>).hourly;
  if (typeof hourly !== 'object' || hourly === null) throw new WeatherError('Wetterdaten ohne Stundenwerte.');
  const h = hourly as Record<string, unknown>;
  if (!Array.isArray(h.time)) throw new WeatherError('Wetterdaten ohne Zeitachse.');
  const col = (name: string): unknown[] => (Array.isArray(h[name]) ? (h[name] as unknown[]) : []);
  const [cover, low, mid, high, precip, vis, hum] = HOURLY_VARS.map(col);

  const hours: HourWeather[] = [];
  h.time.forEach((t, i) => {
    if (typeof t !== 'number' || !Number.isFinite(t)) return;
    hours.push({
      time: t * 1000,
      cloudCover: inRange(cover[i], 0, 100),
      cloudLow: inRange(low[i], 0, 100),
      cloudMid: inRange(mid[i], 0, 100),
      cloudHigh: inRange(high[i], 0, 100),
      precipitation: inRange(precip[i], 0, 500),
      visibility: inRange(vis[i], 0, 1_000_000),
      humidity: inRange(hum[i], 0, 100),
    });
  });
  return hours.sort((a, b) => a.time - b.time);
}

/**
 * Parses an Open-Meteo response. A single location comes back as an object, several as an array
 * in request order (the returned coordinates are grid cells, so order is the only reliable mapping).
 */
export function parseForecastResponse(json: unknown, locations: readonly WeatherLocation[]): Record<string, HourWeather[]> {
  if (typeof json === 'object' && json !== null && (json as Record<string, unknown>).error === true) {
    const reason = (json as Record<string, unknown>).reason;
    throw new WeatherError(`Open-Meteo: ${typeof reason === 'string' ? reason.slice(0, 200) : 'Fehler'}`);
  }
  const list = Array.isArray(json) ? json : [json];
  if (list.length !== locations.length) throw new WeatherError('Wetterdaten passen nicht zu den Spots.');
  const result: Record<string, HourWeather[]> = {};
  locations.forEach((loc, i) => (result[loc.key] = parseLocation(list[i])));
  return result;
}

export type CloudClass = 'hard' | 'mixed' | 'soft';

export const CLOUD_LABEL: Record<CloudClass, string> = { hard: 'hart', mixed: 'wechselnd', soft: 'weich' };

/** Thresholds are assumptions until calibrated with hits (SPEC F15). */
export const CLOUD_THRESHOLDS = {
  softLow: 70,
  softMid: 80,
  hardLow: 20,
  hardMid: 30,
  hardHigh: 70,
} as const;

/** F7: hard = direct sun likely, soft = diffuse light, mixed = in between. Null when data is missing. */
export function classifyClouds(h: Pick<HourWeather, 'cloudLow' | 'cloudMid' | 'cloudHigh'>): CloudClass | null {
  const { cloudLow: low, cloudMid: mid, cloudHigh: high } = h;
  if (low === null || mid === null || high === null) return null;
  const t = CLOUD_THRESHOLDS;
  if (low >= t.softLow || mid >= t.softMid) return 'soft';
  if (low < t.hardLow && mid < t.hardMid && high < t.hardHigh) return 'hard';
  return 'mixed';
}

/** The forecast hour closest to `time`, or null when none is within 90 min. */
export function weatherAt(hours: readonly HourWeather[] | undefined, time: Date): HourWeather | null {
  if (!hours || hours.length === 0) return null;
  const t = time.getTime();
  let best: HourWeather | null = null;
  for (const h of hours) if (!best || Math.abs(h.time - t) < Math.abs(best.time - t)) best = h;
  return best && Math.abs(best.time - t) <= MAX_HOUR_DISTANCE_MS ? best : null;
}

/** Forecast hours whose hour overlaps [start, end). */
export function hoursBetween(hours: readonly HourWeather[] | undefined, start: Date, end: Date): HourWeather[] {
  if (!hours) return [];
  return hours.filter((h) => h.time + HOUR_MS > start.getTime() && h.time < end.getTime());
}

export function needsRefresh(forecast: Forecast | null, locations: readonly WeatherLocation[], now: Date): boolean {
  if (locations.length === 0) return false;
  if (!forecast) return true;
  const age = now.getTime() - Date.parse(forecast.fetchedAt);
  if (!(age >= 0 && age < MAX_FORECAST_AGE_MS)) return true;
  return locations.some((l) => !(l.key in forecast.locations));
}

export function describeClouds(h: HourWeather): string {
  const cls = classifyClouds(h);
  const pct = (v: number | null) => (v === null ? '–' : String(Math.round(v)));
  return `${cls ? CLOUD_LABEL[cls] : 'unbekannt'} · Wolken T/M/H ${pct(h.cloudLow)}/${pct(h.cloudMid)}/${pct(h.cloudHigh)} %`;
}
