import { describe, expect, it } from 'vitest';
import { computeHorizon, emptyGrid, groundHeight, horizonAt, parseHorizon, sampleGrid, suggestAxis, visibilityOutline, type HeightGrid } from './horizon';
import { wgs84ToLv95 } from './lv95';

const NOW = new Date('2026-10-16T10:00:00Z');
// Bern, near the LV95 origin where grid north ≈ true north.
const LAT = 46.948;
const LON = 7.447;
const P = wgs84ToLv95(LAT, LON);

/** Flat ground at 540 m with an optional block of buildings. */
function grid(res: number, radius: number, building?: (de: number, dn: number) => number | null): HeightGrid {
  const size = Math.ceil((2 * radius) / res);
  const g = emptyGrid(P.e - radius, P.n + radius, res, size, size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const de = g.minE + (c + 0.5) * res - P.e;
      const dn = g.maxN - (r + 0.5) * res - P.n;
      g.data[r * size + c] = building?.(de, dn) ?? 540;
    }
  }
  return g;
}

describe('sampleGrid / groundHeight', () => {
  it('samples by LV95 coordinates and returns NaN outside', () => {
    const g = grid(1, 20, (de) => (de > 5 ? 560 : null));
    expect(sampleGrid(g, P.e + 10, P.n)).toBe(560);
    expect(sampleGrid(g, P.e - 10, P.n)).toBe(540);
    expect(sampleGrid(g, P.e + 100, P.n)).toBeNaN();
  });

  it('takes the lowest point nearby as ground (pin on a car or edge)', () => {
    const g = grid(0.5, 20, (de, dn) => (Math.abs(de) < 1 && Math.abs(dn) < 1 ? 542 : null));
    expect(groundHeight(g, P.e, P.n)).toBe(540);
  });
});

describe('computeHorizon', () => {
  it('measures a 20 m wall 10 m to the east', () => {
    // Wall from 10 m east, 20 m high: angle = atan((560 - 541.6) / 10) ≈ 61.5°
    const near = grid(0.5, 60, (de) => (de >= 10 && de < 14 ? 560 : null));
    const h = computeHorizon(LAT, LON, near, null, 'test', NOW)!;
    expect(h.groundM).toBe(540);
    expect(h.deg[90]).toBeGreaterThan(59);
    expect(h.deg[90]).toBeLessThan(63);
    expect(h.deg[270]).toBeLessThan(0);
  });

  it('uses the far grid beyond 60 m', () => {
    // 30 m tower 200 m south: atan((570 - 541.6) / 200) ≈ 8.1°
    const near = grid(0.5, 60);
    const far = grid(2, 300, (de, dn) => (dn <= -200 && dn > -210 && Math.abs(de) < 30 ? 570 : null));
    const h = computeHorizon(LAT, LON, near, far, 'test', NOW)!;
    expect(h.deg[180]).toBeGreaterThan(7.5);
    expect(h.deg[180]).toBeLessThan(8.5);
    expect(h.deg[0]).toBeLessThan(0);
  });

  it('returns null without data', () => {
    expect(computeHorizon(LAT, LON, null, null, 'test', NOW)).toBeNull();
    const empty = emptyGrid(P.e - 10, P.n + 10, 1, 20, 20);
    expect(computeHorizon(LAT, LON, empty, null, 'test', NOW)).toBeNull();
  });
});

describe('horizonAt / parseHorizon', () => {
  const deg = Array.from({ length: 360 }, (_, i) => (i === 90 ? 30 : i === 91 ? 40 : 0));

  it('interpolates and wraps around north', () => {
    expect(horizonAt({ deg }, 90.5)).toBeCloseTo(35, 9);
    expect(horizonAt({ deg }, 450)).toBe(30);
    const wrap = Array.from({ length: 360 }, (_, i) => (i === 359 ? 10 : 0));
    expect(horizonAt({ deg: wrap }, 359.5)).toBeCloseTo(5, 9);
  });

  it('validates untrusted profiles', () => {
    const ok = { deg, groundM: 540, source: 'swissSURFACE3D 2023', computedAt: NOW.toISOString() };
    expect(parseHorizon(ok)).toEqual(ok);
    expect(parseHorizon({ ...ok, deg: deg.slice(1) })).toBeNull();
    expect(parseHorizon({ ...ok, deg: [...deg.slice(1), 'x'] })).toBeNull();
    expect(parseHorizon({ ...ok, computedAt: 'nie' })).toBeNull();
    expect(parseHorizon(null)).toBeNull();
  });
});

describe('suggestAxis', () => {
  /** Buildings 40° everywhere except a street corridor ±8° around `axis` and `axis + 180`. */
  const dist = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
  const street = (axis: number) =>
    Array.from({ length: 360 }, (_, az) => (dist(az, axis) <= 8 || dist(az, axis + 180) <= 8 ? 4 : 40));

  it('finds the corridor of a street', () => {
    expect(suggestAxis({ deg: street(30) })?.axisDeg).toBe(30);
    expect(suggestAxis({ deg: street(165) })?.axisDeg).toBe(165);
  });

  it('handles the wrap at north', () => {
    expect(suggestAxis({ deg: street(2) })?.axisDeg).toBe(2);
    expect(suggestAxis({ deg: street(178) })?.axisDeg).toBe(178);
  });

  it('returns null on an open square', () => {
    expect(suggestAxis({ deg: Array.from({ length: 360 }, () => 3) })).toBeNull();
  });
});

describe('visibilityOutline', () => {
  it('reaches far in open and short in blocked directions', () => {
    const deg = Array.from({ length: 360 }, (_, az) => (az === 90 ? 45 : 0));
    const pts = visibilityOutline({ deg }, LAT, LON, 80);
    expect(pts).toHaveLength(72);
    const dist = ([la, lo]: [number, number]) => Math.hypot((la - LAT) * 111320, (lo - LON) * 111320 * Math.cos((LAT * Math.PI) / 180));
    expect(dist(pts[0])).toBeCloseTo(80, 0);
    expect(dist(pts[18])).toBeCloseTo(3, 0);
  });
});
