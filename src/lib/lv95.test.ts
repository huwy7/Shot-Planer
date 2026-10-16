import { describe, expect, it } from 'vitest';
import { isInSwitzerland, wgs84ToLv95 } from './lv95';

const dms = (d: number, m: number, s: number) => d + m / 60 + s / 3600;

describe('wgs84ToLv95', () => {
  it('places Bern old town in the expected LV95 kilometre tile', () => {
    // The swissSURFACE3D probe on 2026-10-16 found tile 2600-1199 for this point.
    const p = wgs84ToLv95(46.948, 7.447);
    expect(Math.floor(p.e / 1000)).toBe(2600);
    expect(Math.floor(p.n / 1000)).toBe(1199);
  });

  it('matches the swisstopo worked example', () => {
    // swisstopo: 46°02'38.87" / 8°43'49.79" → E 2 700 000, N 1 100 000 (approximate formulas, ~1 m)
    const p = wgs84ToLv95(dms(46, 2, 38.87), dms(8, 43, 49.79));
    expect(Math.abs(p.e - 2700000)).toBeLessThan(2);
    expect(Math.abs(p.n - 1100000)).toBeLessThan(2);
  });

  it('detects points outside the data area', () => {
    expect(isInSwitzerland(46.948, 7.447)).toBe(true);
    expect(isInSwitzerland(48.85, 2.35)).toBe(false);
  });
});
