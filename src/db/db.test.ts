import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createHit, type HitInputs } from '../lib/hits';
import { createSpot } from '../lib/spot';
import { deleteSpot, getForecast, listHits, putHits, getSetting, getSpot, listSpots, openDb, putForecast, putSetting, putSpot, putSpots, type Db } from './db';

const NOW = new Date('2026-10-16T10:00:00.000Z');
const INPUTS: HitInputs = { sun: { azimuthDeg: 90, altitudeDeg: 5 }, weather: null, activeWindows: [], score: null, settings: { toleranceDeg: 10, maxAltitudeDeg: 20 } };
const spot = (id: string) => createSpot({ name: `Spot ${id}`, lat: 46.95, lon: 7.45, axisDeg: 30 }, NOW, id);

let counter = 0;
let db: Db | undefined;
const freshDb = async () => (db = await openDb(`test-${++counter}`));

afterEach(() => db?.close());

describe('db', () => {
  it('creates all stores on first open', async () => {
    const d = await freshDb();
    expect([...d.objectStoreNames].sort()).toEqual(['hits', 'settings', 'spots', 'weatherCache']);
  });

  it('stores, updates and lists spots', async () => {
    const d = await freshDb();
    await putSpot(d, spot('a'));
    await putSpots(d, [spot('b'), { ...spot('a'), name: 'Neu' }]);
    const all = await listSpots(d);
    expect(all.map((s) => [s.id, s.name]).sort()).toEqual([
      ['a', 'Neu'],
      ['b', 'Spot b'],
    ]);
    expect(await getSpot(d, 'b')).toEqual(spot('b'));
  });

  it('deletes a spot together with its hits', async () => {
    const d = await freshDb();
    await putSpots(d, [spot('a'), spot('b')]);
    await putHits(d, [createHit('a', 'good', NOW, INPUTS, 'h1'), createHit('b', 'bad', NOW, INPUTS, 'h2')]);
    await deleteSpot(d, 'a');
    expect(await getSpot(d, 'a')).toBeUndefined();
    expect((await listHits(d)).map((h) => h.id)).toEqual(['h2']);
  });

  it('stores settings', async () => {
    const d = await freshDb();
    expect(await getSetting(d, 'baseLayer')).toBeUndefined();
    await putSetting(d, 'baseLayer', 'osm');
    expect(await getSetting<string>(d, 'baseLayer')).toBe('osm');
  });
});

describe('forecast cache', () => {
  it('stores and replaces the forecast', async () => {
    const d = await freshDb();
    expect(await getForecast(d)).toBeNull();
    await putForecast(d, { fetchedAt: '2026-10-16T10:00:00.000Z', locations: { '46.95,7.45': [] } });
    await putForecast(d, { fetchedAt: '2026-10-16T11:00:00.000Z', locations: {} });
    expect(await getForecast(d)).toEqual({ fetchedAt: '2026-10-16T11:00:00.000Z', locations: {} });
  });
});
