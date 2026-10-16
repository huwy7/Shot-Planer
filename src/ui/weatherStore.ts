import { getForecast, putForecast, type Db } from '../db/db';
import {
  buildForecastUrl,
  needsRefresh,
  parseForecastResponse,
  uniqueLocations,
  WeatherError,
  type Forecast,
} from '../lib/weather';

const FETCH_TIMEOUT_MS = 15000;

export interface WeatherState {
  forecast: Forecast | null;
  loading: boolean;
  error: string | null;
}

/** Holds the cached forecast and refreshes it at most every 60 min (SPEC N3). */
export class WeatherStore {
  state: WeatherState = { forecast: null, loading: false, error: null };
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly onChange: () => void,
  ) {}

  async load(): Promise<void> {
    this.state = { ...this.state, forecast: await getForecast(this.db) };
  }

  /** Fetches when stale or a spot's location is missing; `force` ignores the age. */
  refresh(points: readonly { lat: number; lon: number }[], force = false): Promise<void> {
    const locations = uniqueLocations(points);
    if (locations.length === 0) return Promise.resolve();
    if (!force && !needsRefresh(this.state.forecast, locations, new Date())) return Promise.resolve();
    if (this.inFlight) return this.inFlight;

    this.state = { ...this.state, loading: true, error: null };
    this.onChange();
    this.inFlight = (async () => {
      try {
        const res = await fetch(buildForecastUrl(locations), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new WeatherError(`Open-Meteo antwortet nicht lesbar (HTTP ${res.status}).`);
        }
        const forecast: Forecast = { fetchedAt: new Date().toISOString(), locations: parseForecastResponse(json, locations) };
        await putForecast(this.db, forecast);
        this.state = { forecast, loading: false, error: null };
      } catch (err) {
        const message =
          err instanceof WeatherError
            ? err.message
            : navigator.onLine === false
              ? 'Offline – letzte Prognose wird angezeigt.'
              : 'Wetter konnte nicht geladen werden.';
        this.state = { ...this.state, loading: false, error: message };
      } finally {
        this.inFlight = null;
        this.onChange();
      }
    })();
    return this.inFlight;
  }
}
