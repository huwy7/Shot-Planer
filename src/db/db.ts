import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Hit } from '../lib/hits';
import type { Spot } from '../lib/spot';
import type { Forecast } from '../lib/weather';

export const DB_NAME = 'shot-planer';
/** Bump only together with a migration step in `upgrade`. */
export const DB_VERSION = 1;


export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface WeatherCacheRecord {
  key: string;
  fetchedAt: string;
  data: unknown;
}

interface ShotPlanerDB extends DBSchema {
  spots: { key: string; value: Spot };
  hits: { key: string; value: Hit; indexes: { bySpot: string } };
  settings: { key: string; value: SettingRecord };
  weatherCache: { key: string; value: WeatherCacheRecord };
}

export type Db = IDBPDatabase<ShotPlanerDB>;

export function openDb(name: string = DB_NAME): Promise<Db> {
  return openDB<ShotPlanerDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('spots', { keyPath: 'id' });
        const hits = db.createObjectStore('hits', { keyPath: 'id' });
        hits.createIndex('bySpot', 'spotId');
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('weatherCache', { keyPath: 'key' });
      }
    },
  });
}

export function listSpots(db: Db): Promise<Spot[]> {
  return db.getAll('spots');
}

export function getSpot(db: Db, id: string): Promise<Spot | undefined> {
  return db.get('spots', id);
}

export async function putSpot(db: Db, spot: Spot): Promise<void> {
  await db.put('spots', spot);
}

export async function putSpots(db: Db, spots: readonly Spot[]): Promise<void> {
  const tx = db.transaction('spots', 'readwrite');
  await Promise.all([...spots.map((s) => tx.store.put(s)), tx.done]);
}

/** Deletes a spot together with its hits. */
export async function deleteSpot(db: Db, id: string): Promise<void> {
  const tx = db.transaction(['spots', 'hits'], 'readwrite');
  const hits = tx.objectStore('hits');
  const hitKeys = await hits.index('bySpot').getAllKeys(id);
  await Promise.all([tx.objectStore('spots').delete(id), ...hitKeys.map((k) => hits.delete(k)), tx.done]);
}

export async function getSetting<T>(db: Db, key: string): Promise<T | undefined> {
  return (await db.get('settings', key))?.value as T | undefined;
}

export async function putSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.put('settings', { key, value });
}

const FORECAST_KEY = 'forecast';

export async function getForecast(db: Db): Promise<Forecast | null> {
  const record = await db.get('weatherCache', FORECAST_KEY);
  return (record?.data as Forecast | undefined) ?? null;
}

export async function putForecast(db: Db, forecast: Forecast): Promise<void> {
  await db.put('weatherCache', { key: FORECAST_KEY, fetchedAt: forecast.fetchedAt, data: forecast });
}

export function listHits(db: Db): Promise<Hit[]> {
  return db.getAll('hits');
}

export async function putHits(db: Db, hits: readonly Hit[]): Promise<void> {
  const tx = db.transaction('hits', 'readwrite');
  await Promise.all([...hits.map((h) => tx.store.put(h)), tx.done]);
}
