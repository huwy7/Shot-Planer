import { describe, expect, it } from 'vitest';
import { shadowFactor, sunAt } from './sun';

describe('shadowFactor', () => {
  it('is 1 at 45° and grows towards the horizon', () => {
    expect(shadowFactor(45)).toBeCloseTo(1, 9);
    expect(shadowFactor(10)).toBeCloseTo(5.67, 2);
    expect(shadowFactor(0.2)).toBeNull();
    expect(shadowFactor(-3)).toBeNull();
  });
});

describe('sunAt', () => {
  it('returns degrees with north-based azimuth', () => {
    // Bern, near solar noon at equinox: sun due south, ~43° high.
    const p = sunAt(46.948, 7.447)(new Date('2026-03-20T11:38:00Z'));
    expect(p.azimuthDeg).toBeGreaterThan(175);
    expect(p.azimuthDeg).toBeLessThan(185);
    expect(p.altitudeDeg).toBeCloseTo(43, 0);
  });
});
