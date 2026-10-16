import { describe, expect, it } from 'vitest';
import { parseTiffHeader, TiffError } from './tiff';

/** Builds a little-endian classic TIFF with one IFD and out-of-line doubles/shorts after it. */
function buildTiff(opts: { tiled: boolean; epsg?: number; ifdAt?: number }): ArrayBuffer {
  const ifdAt = opts.ifdAt ?? 8;
  const entries: [number, number, number, number[]][] = [
    [256, 4, 1, [2000]],
    [257, 4, 1, [2000]],
    [258, 3, 1, [32]],
    [259, 3, 1, [8]],
  ];
  if (opts.tiled) entries.push([322, 3, 1, [512]], [323, 3, 1, [512]]);
  entries.push([33550, 12, 3, [0.5, 0.5, 0]], [33922, 12, 6, [0, 0, 0, 2600000, 1200000, 0]]);
  if (opts.epsg) entries.push([34735, 3, 8, [1, 1, 0, 1, 3072, 0, 1, opts.epsg]]);
  entries.sort((a, b) => a[0] - b[0]);

  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = ifdAt + ifdSize;
  const buf = new ArrayBuffer(extra + 256);
  const v = new DataView(buf);
  v.setUint16(0, 0x4949, false);
  v.setUint16(2, 42, true);
  v.setUint32(4, ifdAt, true);
  v.setUint16(ifdAt, entries.length, true);
  entries.forEach(([tag, type, count, vals], i) => {
    const e = ifdAt + 2 + i * 12;
    v.setUint16(e, tag, true);
    v.setUint16(e + 2, type, true);
    v.setUint32(e + 4, count, true);
    const size = type === 12 ? 8 : type === 4 ? 4 : 2;
    const write = (o: number, x: number) => (type === 12 ? v.setFloat64(o, x, true) : type === 4 ? v.setUint32(o, x, true) : v.setUint16(o, x, true));
    if (size * count <= 4) vals.forEach((x, k) => write(e + 8 + k * size, x));
    else {
      v.setUint32(e + 8, extra, true);
      vals.forEach((x, k) => write(extra + k * size, x));
      extra += size * count;
    }
  });
  return buf;
}

describe('parseTiffHeader', () => {
  it('reads size, tiling, georeference and EPSG of a COG-like file', () => {
    const info = parseTiffHeader(buildTiff({ tiled: true, epsg: 2056 }));
    expect(info).toMatchObject({
      littleEndian: true,
      bigTiff: false,
      width: 2000,
      height: 2000,
      tileWidth: 512,
      tileHeight: 512,
      compression: 8,
      bitsPerSample: 32,
      pixelScale: [0.5, 0.5],
      origin: [2600000, 1200000],
      epsg: 2056,
      ifdNearStart: true,
    });
  });

  it('reports untiled files and missing GeoKeys', () => {
    const info = parseTiffHeader(buildTiff({ tiled: false }));
    expect(info.tileWidth).toBeNull();
    expect(info.epsg).toBeNull();
  });

  it('rejects non-TIFF data and truncated headers', () => {
    expect(() => parseTiffHeader(new TextEncoder().encode('<html>not a tiff</html>').buffer)).toThrow(TiffError);
    const full = buildTiff({ tiled: true, epsg: 2056 });
    expect(() => parseTiffHeader(full.slice(0, 40))).toThrow('ausserhalb');
  });
});
