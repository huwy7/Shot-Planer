import { describe, expect, it } from 'vitest';
import { angularDiff, axisDiff, bearing, normalizeAxis, normalizeDeg, sunCalcAzimuthToDeg } from './angles';

describe('normalizeDeg', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeDeg(370)).toBe(10);
    expect(normalizeDeg(-10)).toBe(350);
    expect(normalizeDeg(360)).toBe(0);
  });
});

describe('normalizeAxis', () => {
  it('treats opposite directions as the same axis', () => {
    expect(normalizeAxis(210)).toBe(30);
    expect(normalizeAxis(180)).toBe(0);
    expect(normalizeAxis(-30)).toBe(150);
  });
});

describe('angularDiff', () => {
  it('takes the short way around', () => {
    expect(angularDiff(350, 10)).toBe(20);
    expect(angularDiff(0, 180)).toBe(180);
    expect(angularDiff(90, 90)).toBe(0);
  });
});

describe('axisDiff', () => {
  it('is 0 for sun along the street from either end', () => {
    expect(axisDiff(30, 30)).toBe(0);
    expect(axisDiff(210, 30)).toBe(0);
  });
  it('is 90 for sun perpendicular to the street', () => {
    expect(axisDiff(120, 30)).toBe(90);
    expect(axisDiff(300, 30)).toBe(90);
  });
  it('wraps around north', () => {
    expect(axisDiff(355, 5)).toBe(10);
    expect(axisDiff(175, 5)).toBe(10);
  });
});

describe('bearing', () => {
  it('returns cardinal directions', () => {
    expect(bearing(46.9, 7.4, 47.0, 7.4)).toBeCloseTo(0, 6);
    expect(bearing(47.0, 7.4, 46.9, 7.4)).toBeCloseTo(180, 6);
    expect(bearing(46.9, 7.4, 46.9, 7.5)).toBeCloseTo(90, 0);
    expect(bearing(46.9, 7.5, 46.9, 7.4)).toBeCloseTo(270, 0);
  });
});

describe('sunCalcAzimuthToDeg', () => {
  it('maps SunCalc south-based radians to north-based degrees', () => {
    expect(sunCalcAzimuthToDeg(0)).toBe(180); // south
    expect(sunCalcAzimuthToDeg(Math.PI / 2)).toBeCloseTo(270, 9); // west
    expect(sunCalcAzimuthToDeg(-Math.PI / 2)).toBeCloseTo(90, 9); // east
    expect(sunCalcAzimuthToDeg(Math.PI)).toBeCloseTo(0, 9); // north
  });
});
