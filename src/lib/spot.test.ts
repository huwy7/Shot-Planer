import { describe, expect, it } from 'vitest';
import { clampMinSunAlt, cleanAxis, createSpot, parseSpot, sortByName, updateSpot, validateSpotInput } from './spot';

const NOW = new Date('2026-10-16T10:00:00.000Z');
const base = { name: 'Kramgasse', lat: 46.9478, lon: 7.4505 };

describe('cleanAxis', () => {
  it('returns null for missing values', () => {
    expect(cleanAxis(null)).toBeNull();
    expect(cleanAxis(undefined)).toBeNull();
    expect(cleanAxis(Number.NaN)).toBeNull();
  });
  it('folds opposite directions onto [0, 180)', () => {
    expect(cleanAxis(250)).toBe(70);
    expect(cleanAxis(180)).toBe(0);
    expect(cleanAxis(-10)).toBe(170);
  });
  it('rounds to 0.1° and never yields 180', () => {
    expect(cleanAxis(63.456)).toBe(63.5);
    expect(cleanAxis(179.97)).toBe(0);
  });
});

describe('clampMinSunAlt', () => {
  it('clamps to 0–60 and rounds', () => {
    expect(clampMinSunAlt(undefined)).toBe(0);
    expect(clampMinSunAlt(-5)).toBe(0);
    expect(clampMinSunAlt(14.6)).toBe(15);
    expect(clampMinSunAlt(90)).toBe(60);
  });
});

describe('validateSpotInput', () => {
  it('requires a name', () => {
    expect(validateSpotInput({ ...base, name: '   ' })).toBe('Name fehlt.');
  });
  it('rejects coordinates out of range', () => {
    expect(validateSpotInput({ ...base, lat: 91 })).not.toBeNull();
    expect(validateSpotInput({ ...base, lon: Number.NaN })).not.toBeNull();
  });
  it('accepts a valid spot', () => {
    expect(validateSpotInput(base)).toBeNull();
  });
});

describe('createSpot / updateSpot', () => {
  it('trims text and sets timestamps', () => {
    const s = createSpot({ ...base, name: '  Kramgasse ', note: ' Arkaden ', axisDeg: 260 }, NOW, 'id-1');
    expect(s).toMatchObject({ id: 'id-1', name: 'Kramgasse', note: 'Arkaden', axisDeg: 80, minSunAltDeg: 0 });
    expect(s.createdAt).toBe(NOW.toISOString());
  });
  it('keeps id and createdAt on update', () => {
    const s = createSpot(base, NOW, 'id-1');
    const later = new Date('2026-10-17T10:00:00.000Z');
    const u = updateSpot(s, { ...base, name: 'Gerechtigkeitsgasse', minSunAltDeg: 12 }, later);
    expect(u).toMatchObject({ id: 'id-1', name: 'Gerechtigkeitsgasse', minSunAltDeg: 12 });
    expect(u.createdAt).toBe(NOW.toISOString());
    expect(u.updatedAt).toBe(later.toISOString());
  });
});

describe('parseSpot', () => {
  const valid = createSpot({ ...base, axisDeg: 45, minSunAltDeg: 10 }, NOW, 'id-1');

  it('round-trips a valid spot', () => {
    expect(parseSpot(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });
  it('rejects junk', () => {
    expect(parseSpot(null)).toBeNull();
    expect(parseSpot('x')).toBeNull();
    expect(parseSpot({ ...valid, id: '' })).toBeNull();
    expect(parseSpot({ ...valid, lat: '46.9' })).toBeNull();
    expect(parseSpot({ ...valid, name: '' })).toBeNull();
    expect(parseSpot({ ...valid, updatedAt: 'gestern' })).toBeNull();
    expect(parseSpot({ ...valid, axisDeg: 'N' })).toBeNull();
  });
  it('normalizes out-of-range fields', () => {
    expect(parseSpot({ ...valid, axisDeg: 225, minSunAltDeg: 99 })).toMatchObject({ axisDeg: 45, minSunAltDeg: 60 });
  });
  it('accepts missing optional fields', () => {
    const { note: _note, minSunAltDeg: _min, ...rest } = valid;
    expect(parseSpot({ ...rest, axisDeg: null })).toMatchObject({ note: '', minSunAltDeg: 0, axisDeg: null });
  });
});

describe('sortByName', () => {
  it('sorts with German collation, ignoring case', () => {
    const names = ['zytglogge', 'Bärenplatz', 'Aarstrasse', 'bahnhof'];
    const spots = names.map((name, i) => createSpot({ ...base, name }, NOW, `id-${i}`));
    expect(sortByName(spots).map((s) => s.name)).toEqual(['Aarstrasse', 'bahnhof', 'Bärenplatz', 'zytglogge']);
  });
});
