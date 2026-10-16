// swisstopo STAC: find the newest swissSURFACE3D Raster tile covering a point (3D-data probe, SPEC §11).

export const STAC_BASE = 'https://data.geo.admin.ch/api/stac/v1';
export const DSM_COLLECTION = 'ch.swisstopo.swisssurface3d-raster';

/** Items intersecting a box of `radiusM` around the point (default ~50 m). */
export function dsmItemsUrl(lat: number, lon: number, radiusM = 50): string {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(5)).join(',');
  return `${STAC_BASE}/collections/${DSM_COLLECTION}/items?bbox=${bbox}&limit=20`;
}

export interface StacAsset {
  itemId: string;
  datetime: string | null;
  key: string;
  href: string;
  type: string | null;
  /** Ground sampling distance in meters, from the asset or parsed from its name. */
  gsd: number | null;
}

/** Only https URLs on swisstopo's data host are accepted from the (untrusted) response. */
function isAllowedHref(href: unknown): href is string {
  if (typeof href !== 'string') return false;
  try {
    const u = new URL(href);
    return u.protocol === 'https:' && u.hostname === 'data.geo.admin.ch';
  } catch {
    return false;
  }
}

function gsdOf(key: string, asset: Record<string, unknown>): number | null {
  const g = asset['gsd'] ?? asset['eo:gsd'];
  if (typeof g === 'number' && Number.isFinite(g)) return g;
  // Name ends in _<gsd>_<epsg>_<height ref>.tif, e.g. ..._2019_2600-1199_0.5_2056_5728.tif
  const m = /_(\d+(?:\.\d+)?)_\d{4,5}_\d+\.tiff?$/i.exec(key);
  return m ? Number(m[1]) : null;
}

/** All GeoTIFF assets of a STAC item collection response. */
export function parseStacAssets(json: unknown): StacAsset[] {
  if (typeof json !== 'object' || json === null) return [];
  const features = (json as Record<string, unknown>).features;
  if (!Array.isArray(features)) return [];
  const out: StacAsset[] = [];
  for (const f of features) {
    if (typeof f !== 'object' || f === null) continue;
    const item = f as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '?';
    const props = (typeof item.properties === 'object' && item.properties) || {};
    const dt = (props as Record<string, unknown>).datetime;
    const assets = item.assets;
    if (typeof assets !== 'object' || assets === null) continue;
    for (const [key, raw] of Object.entries(assets as Record<string, unknown>)) {
      if (typeof raw !== 'object' || raw === null) continue;
      const a = raw as Record<string, unknown>;
      if (!isAllowedHref(a.href)) continue;
      const type = typeof a.type === 'string' ? a.type : null;
      const isTiff = (type?.includes('tiff') ?? false) || /\.tiff?$/i.test(a.href);
      if (!isTiff) continue;
      out.push({ itemId: id, datetime: typeof dt === 'string' ? dt : null, key, href: a.href, type, gsd: gsdOf(key, a) });
    }
  }
  return out;
}

/** Prefers the finest resolution, then the newest acquisition. */
export function pickDsmAsset(assets: readonly StacAsset[]): StacAsset | null {
  return (
    [...assets].sort((a, b) => (a.gsd ?? 99) - (b.gsd ?? 99) || (b.datetime ?? '').localeCompare(a.datetime ?? ''))[0] ?? null
  );
}

/** One asset per 1-km tile (finest, newest); the tile key is the "2600-1199" suffix of the item id. */
export function pickTileAssets(assets: readonly StacAsset[]): StacAsset[] {
  const byTile = new Map<string, StacAsset[]>();
  for (const a of assets) {
    const key = /(\d{4}-\d{4})$/.exec(a.itemId)?.[1] ?? a.itemId;
    byTile.set(key, [...(byTile.get(key) ?? []), a]);
  }
  return [...byTile.values()].map((list) => pickDsmAsset(list)).filter((a): a is StacAsset => a !== null);
}
