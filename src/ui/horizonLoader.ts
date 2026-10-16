// Loads swissSURFACE3D windows around a spot and computes its horizon (SPEC §11 stage 2).
// geotiff.js is imported lazily so the app shell stays small.

import type { GeoTIFF } from 'geotiff';
import { computeHorizon, emptyGrid, HORIZON, type HeightGrid, type HorizonProfile } from '../lib/horizon';
import { isInSwitzerland, wgs84ToLv95 } from '../lib/lv95';
import { dsmItemsUrl, parseStacAssets, pickTileAssets } from '../lib/stac';

export class HorizonError extends Error {
  override name = 'HorizonError';
}

const NEAR_RES = 0.5;
const FAR_RES = 2;
const TIMEOUT_MS = 60000;
/** Values below this are treated as "no data" (swisstopo uses large negative fill values). */
const MIN_VALID_HEIGHT = -500;

interface OpenTile {
  tiff: GeoTIFF;
  bbox: number[];
  noData: number | null;
}

/** Fills a grid of `radius` around (e, n) at `res` from all tiles that overlap it. */
async function fillGrid(tiles: OpenTile[], e: number, n: number, radius: number, res: number): Promise<HeightGrid> {
  const minE = Math.floor((e - radius) / res) * res;
  const maxN = Math.ceil((n + radius) / res) * res;
  const size = Math.ceil((2 * radius) / res) + 1;
  const grid = emptyGrid(minE, maxN, res, size, size);
  const gridBox = [minE, maxN - size * res, minE + size * res, maxN];

  for (const t of tiles) {
    const ix0 = Math.max(gridBox[0], t.bbox[0]);
    const iy0 = Math.max(gridBox[1], t.bbox[1]);
    const ix1 = Math.min(gridBox[2], t.bbox[2]);
    const iy1 = Math.min(gridBox[3], t.bbox[3]);
    const w = Math.round((ix1 - ix0) / res);
    const h = Math.round((iy1 - iy0) / res);
    if (w <= 0 || h <= 0) continue;
    const raster = await t.tiff.readRasters({ bbox: [ix0, iy0, ix1, iy1], width: w, height: h, samples: [0], interleave: true });
    const values = raster as unknown as ArrayLike<number>;
    const col0 = Math.round((ix0 - minE) / res);
    const row0 = Math.round((maxN - iy1) / res);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const v = values[r * w + c];
        if (!Number.isFinite(v) || v === t.noData || v < MIN_VALID_HEIGHT) continue;
        const gr = row0 + r;
        const gc = col0 + c;
        if (gr >= 0 && gc >= 0 && gr < size && gc < size) grid.data[gr * size + gc] = v;
      }
    }
  }
  return grid;
}

export async function loadHorizon(lat: number, lon: number, onProgress: (text: string) => void): Promise<HorizonProfile> {
  if (!isInSwitzerland(lat, lon)) throw new HorizonError('Höhendaten gibt es nur für die Schweiz.');
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const margin = 2 * FAR_RES;

  onProgress('Suche Höhendaten …');
  let json: unknown;
  try {
    const res = await fetch(dsmItemsUrl(lat, lon, HORIZON.farRadiusM + margin), { signal });
    if (!res.ok) throw new HorizonError(`swisstopo-Katalog: HTTP ${res.status}`);
    json = await res.json();
  } catch (err) {
    if (err instanceof HorizonError) throw err;
    throw new HorizonError('swisstopo nicht erreichbar.');
  }
  const assets = pickTileAssets(parseStacAssets(json));
  if (assets.length === 0) throw new HorizonError('Keine Höhendaten für diesen Ort gefunden.');

  onProgress('Lade Leser …');
  const { fromUrl } = await import('geotiff');

  onProgress(`Lade ${assets.length === 1 ? '1 Kachel' : `${assets.length} Kacheln`} …`);
  let tiles: OpenTile[];
  try {
    tiles = await Promise.all(
      assets.map(async (a) => {
        // Cache raw blocks and decoded tiles: the near window lies inside the far one.
        const tiff = await fromUrl(a.href, { allowFullFile: false, blockSize: 65536, cacheSize: 256, cache: true } as Parameters<typeof fromUrl>[1], signal);
        const image = await tiff.getImage();
        return { tiff, bbox: image.getBoundingBox(), noData: image.getGDALNoData() };
      }),
    );
  } catch {
    throw new HorizonError('Höhendaten konnten nicht geöffnet werden.');
  }

  const p = wgs84ToLv95(lat, lon);
  let near: HeightGrid;
  let far: HeightGrid;
  try {
    onProgress('Lese Umgebung (2 m) …');
    far = await fillGrid(tiles, p.e, p.n, HORIZON.farRadiusM + margin, FAR_RES);
    onProgress('Lese Nahbereich (0,5 m) …');
    near = await fillGrid(tiles, p.e, p.n, HORIZON.nearRadiusM + margin, NEAR_RES);
  } catch {
    throw new HorizonError('Höhendaten konnten nicht gelesen werden.');
  }

  onProgress('Berechne Horizont …');
  const years = [...new Set(assets.map((a) => a.datetime?.slice(0, 4)).filter(Boolean))].sort().join('/');
  const profile = computeHorizon(lat, lon, near, far, `swissSURFACE3D ${years}`.trim(), new Date());
  if (!profile) throw new HorizonError('Am Spot fehlen Höhenwerte.');
  return profile;
}
