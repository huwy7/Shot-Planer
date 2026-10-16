import { describe, expect, it } from 'vitest';
import { angularDiff, axisDiff, bearing, compassLabel, destination, normalizeAxis, normalizeDeg } from './angles';

describe('compassLabel', () => {
  it('maps to the nearest of 8 points', () => {
    expect(compassLabel(0)).toBe('N');
    expect(compassLabel(22)).toBe('N');
    expect(compassLabel(23)).toBe('NO');
    expect(compassLabel(100)).toBe('O');
    expect(compassLabel(225)).toBe('SW');
    expect(compassLabel(350)).toBe('N');
    expect(compassLabel(-90)).toBe('W');
  });
});

describe('destination', () => {
  it('moves north by about 111 m per 0.001° latitude', () => {
    const [lat, lon] = destination(46.948, 7.447, 0, 111.2);
    expect(lat).toBeCloseTo(46.949, 4);
    expect(lon).toBeCloseTo(7.447, 9);
  });
  it('round-trips with bearing', () => {
    const [lat, lon] = destination(46.948, 7.447, 63, 50);
    expect(bearing(46.948, 7.447, lat, lon)).toBeCloseTo(63, 3);
  });
});

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
