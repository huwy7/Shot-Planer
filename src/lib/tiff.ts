// Minimal TIFF/GeoTIFF header reader for the 3D-data probe. Reads the first IFD only; no pixel decoding.

export interface TiffInfo {
  littleEndian: boolean;
  bigTiff: boolean;
  width: number | null;
  height: number | null;
  /** Set when the image is tiled (a requirement for Cloud Optimized GeoTIFF). */
  tileWidth: number | null;
  tileHeight: number | null;
  compression: number | null;
  bitsPerSample: number | null;
  /** Pixel size in CRS units (x, y). */
  pixelScale: [number, number] | null;
  /** Model coordinates of the raster origin (x, y). */
  origin: [number, number] | null;
  /** EPSG code from the GeoKey directory (ProjectedCSTypeGeoKey or GeographicTypeGeoKey). */
  epsg: number | null;
  /** True when the first IFD starts within the first 16 KiB — typical for COGs. */
  ifdNearStart: boolean;
}

export class TiffError extends Error {}

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  tileWidth: 322,
  tileHeight: 323,
  pixelScale: 33550,
  tiepoint: 33922,
  geoKeys: 34735,
} as const;

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

/** Parses the header and first IFD. `buf` must contain the IFD and its out-of-line values (64 KiB is plenty for COGs). */
export function parseTiffHeader(buf: ArrayBuffer): TiffInfo {
  const view = new DataView(buf);
  if (buf.byteLength < 16) throw new TiffError('Datei zu kurz für einen TIFF-Kopf.');
  const order = view.getUint16(0, false);
  if (order !== 0x4949 && order !== 0x4d4d) throw new TiffError('Kein TIFF (Byte-Reihenfolge fehlt).');
  const le = order === 0x4949;
  const magic = view.getUint16(2, le);
  if (magic !== 42 && magic !== 43) throw new TiffError('Kein TIFF (Kennung fehlt).');
  const big = magic === 43;

  const u64 = (o: number) => Number(view.getBigUint64(o, le));
  const ifdOffset = big ? u64(8) : view.getUint32(4, le);
  const need = (o: number, n: number) => {
    if (o + n > buf.byteLength) throw new TiffError('TIFF-Kopf liegt ausserhalb des geladenen Bereichs.');
  };

  need(ifdOffset, big ? 8 : 2);
  const count = big ? u64(ifdOffset) : view.getUint16(ifdOffset, le);
  const entrySize = big ? 20 : 12;
  const first = ifdOffset + (big ? 8 : 2);
  need(first, count * entrySize);

  const values = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const e = first + i * entrySize;
    const tag = view.getUint16(e, le);
    const type = view.getUint16(e + 2, le);
    const n = big ? u64(e + 4) : view.getUint32(e + 4, le);
    const size = TYPE_SIZE[type];
    if (!size || !Object.values(TAG).includes(tag as never)) continue;
    const inline = size * n <= (big ? 8 : 4);
    const at = inline ? e + (big ? 12 : 8) : big ? u64(e + 12) : view.getUint32(e + 8, le);
    need(at, size * n);
    const read: number[] = [];
    for (let k = 0; k < Math.min(n, 64); k++) {
      const o = at + k * size;
      if (type === 3) read.push(view.getUint16(o, le));
      else if (type === 4) read.push(view.getUint32(o, le));
      else if (type === 16) read.push(u64(o));
      else if (type === 12) read.push(view.getFloat64(o, le));
      else if (type === 11) read.push(view.getFloat32(o, le));
      else if (type === 1) read.push(view.getUint8(o));
    }
    values.set(tag, read);
  }

  const one = (tag: number) => values.get(tag)?.[0] ?? null;
  const scale = values.get(TAG.pixelScale);
  const tie = values.get(TAG.tiepoint);
  return {
    littleEndian: le,
    bigTiff: big,
    width: one(TAG.width),
    height: one(TAG.height),
    tileWidth: one(TAG.tileWidth),
    tileHeight: one(TAG.tileHeight),
    compression: one(TAG.compression),
    bitsPerSample: one(TAG.bitsPerSample),
    pixelScale: scale && scale.length >= 2 ? [scale[0], scale[1]] : null,
    origin: tie && tie.length >= 6 ? [tie[3], tie[4]] : null,
    epsg: epsgFromGeoKeys(values.get(TAG.geoKeys)),
    ifdNearStart: ifdOffset < 16 * 1024,
  };
}

/** GeoKey directory: header of 4 shorts, then entries of (key, location, count, value). */
function epsgFromGeoKeys(keys: number[] | undefined): number | null {
  if (!keys || keys.length < 4) return null;
  const PROJECTED = 3072;
  const GEOGRAPHIC = 2048;
  let geographic: number | null = null;
  for (let i = 4; i + 3 < keys.length; i += 4) {
    const [key, location, , value] = keys.slice(i, i + 4);
    if (location !== 0) continue;
    if (key === PROJECTED) return value;
    if (key === GEOGRAPHIC) geographic = value;
  }
  return geographic;
}
