import { describe, expect, it } from 'vitest';
import {
  clampLightSettings,
  computeDayLight,
  DEFAULT_LIGHT_SETTINGS,
  litFacadeDirection,
  localDay,
  sunVisible,
  type LightWindow,
  type WindowKind,
} from './light';
import { sunAt, type SunFn } from './sun';

const HOUR = 3600 * 1000;
const DAY = { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-03-02T00:00:00Z') };
const hoursOf = (d: Date) => (d.getTime() - DAY.start.getTime()) / HOUR;

/** Synthetic sun: azimuth 15°/h through south at 12h, altitude 40° at noon dropping 5°/h. */
const fakeSun: SunFn = (d) => {
  const h = hoursOf(d);
  return { azimuthDeg: 180 + 15 * (h - 12), altitudeDeg: 40 - 5 * Math.abs(h - 12) };
};

const ofKind = (ws: LightWindow[], kind: WindowKind) => ws.filter((w) => w.kind === kind);
const span = (w: LightWindow) => [hoursOf(w.start), hoursOf(w.end)];

describe('computeDayLight with a synthetic sun', () => {
  const eastWest = { axisDeg: 90, minSunAltDeg: 0 };

  it('finds blue and golden hours morning and evening', () => {
    const { windows } = computeDayLight(fakeSun, DAY, eastWest, DEFAULT_LIGHT_SETTINGS);
    const golden = ofKind(windows, 'golden');
    expect(golden.map((w) => w.period)).toEqual(['morning', 'evening']);
    expect(span(golden[0])[0]).toBeCloseTo(3.2, 2);
    expect(span(golden[0])[1]).toBeCloseTo(5.2, 2);
    expect(span(golden[1])[0]).toBeCloseTo(18.8, 2);
    const blue = ofKind(windows, 'blue');
    expect(blue).toHaveLength(2);
    expect(span(blue[0])[0]).toBeCloseTo(2.8, 2);
    expect(span(blue[0])[1]).toBeCloseTo(3.2, 2);
  });

  it('finds light along an east-west street at sunrise and sunset sides', () => {
    const { windows } = computeDayLight(fakeSun, DAY, eastWest, DEFAULT_LIGHT_SETTINGS);
    const along = ofKind(windows, 'along');
    expect(along).toHaveLength(2);
    expect(span(along[0])[0]).toBeCloseTo(5 + 1 / 3, 2);
    expect(span(along[0])[1]).toBeCloseTo(6 + 2 / 3, 2);
    expect(along[0].label).toContain('aus O');
    expect(along[1].label).toContain('aus W');
    expect(along[0].period).toBe('morning');
  });

  it('respects the maximum altitude for across windows', () => {
    expect(ofKind(computeDayLight(fakeSun, DAY, eastWest, DEFAULT_LIGHT_SETTINGS).windows, 'across')).toHaveLength(0);
    const high = computeDayLight(fakeSun, DAY, eastWest, { ...DEFAULT_LIGHT_SETTINGS, maxAltitudeDeg: 45 });
    const across = ofKind(high.windows, 'across');
    expect(across).toHaveLength(1);
    expect(span(across[0])[0]).toBeCloseTo(11 + 1 / 3, 2);
    expect(across[0].label).toContain('Richtung S');
    expect(across[0].altitudeRange[1]).toBeCloseTo(40, 1);
  });

  it('respects the spot minimum sun altitude', () => {
    const { windows } = computeDayLight(fakeSun, DAY, { axisDeg: 90, minSunAltDeg: 8 }, DEFAULT_LIGHT_SETTINGS);
    expect(span(ofKind(windows, 'along')[0])[0]).toBeCloseTo(5.6, 2);
  });

  it('treats axis 0° and 180° alike and skips axis windows without an axis', () => {
    const north = computeDayLight(fakeSun, DAY, { axisDeg: 0, minSunAltDeg: 0 }, { ...DEFAULT_LIGHT_SETTINGS, maxAltitudeDeg: 45 });
    expect(ofKind(north.windows, 'along').map((w) => w.label)).toEqual([expect.stringContaining('aus S')]);
    const none = computeDayLight(fakeSun, DAY, { axisDeg: null, minSunAltDeg: 0 }, DEFAULT_LIGHT_SETTINGS);
    expect(none.windows.every((w) => w.kind === 'blue' || w.kind === 'golden')).toBe(true);
  });

  it('reports the highest sun', () => {
    const { maxAltitude } = computeDayLight(fakeSun, DAY, eastWest, DEFAULT_LIGHT_SETTINGS);
    expect(maxAltitude.altitudeDeg).toBeCloseTo(40, 6);
    expect(hoursOf(maxAltitude.time)).toBeCloseTo(12, 6);
  });
});

describe('litFacadeDirection', () => {
  it('picks the facade normal facing the sun', () => {
    expect(litFacadeDirection(90, 175)).toBe(180);
    expect(litFacadeDirection(90, 10)).toBe(0);
    expect(litFacadeDirection(30, 130)).toBe(120);
    expect(litFacadeDirection(30, 290)).toBe(300);
  });
});

describe('clampLightSettings', () => {
  it('falls back to defaults and clamps', () => {
    expect(clampLightSettings(undefined)).toEqual(DEFAULT_LIGHT_SETTINGS);
    expect(clampLightSettings({ toleranceDeg: 99, maxAltitudeDeg: 1 })).toEqual({ toleranceDeg: 30, maxAltitudeDeg: 5 });
  });
});

describe('localDay', () => {
  it('spans one local calendar day', () => {
    const { start, end } = localDay(new Date(2026, 9, 16, 15, 30), 1);
    expect([start.getDate(), start.getHours(), end.getDate()]).toEqual([17, 0, 18]);
  });
});

describe('real sun in Bern', () => {
  const bern = sunAt(46.948, 7.447);
  const utcDay = (iso: string) => ({ start: new Date(`${iso}T00:00:00Z`), end: new Date(`${iso}T23:59:59Z`) });
  const noGeom = { axisDeg: null, minSunAltDeg: 0 };

  it('matches the expected noon altitude at equinox and solstices', () => {
    // 90° − latitude + declination; SunCalc altitude includes ~0.02° refraction at these heights.
    const cases: [string, number][] = [
      ['2026-03-20', 43.05],
      ['2026-06-21', 66.49],
      ['2026-12-21', 19.62],
    ];
    for (const [iso, expected] of cases) {
      const { maxAltitude } = computeDayLight(bern, utcDay(iso), noGeom, DEFAULT_LIGHT_SETTINGS);
      expect(maxAltitude.altitudeDeg).toBeCloseTo(expected, 0);
      // Solar noon in Bern is around 11:30–11:45 UTC.
      expect(maxAltitude.time.getUTCHours() * 60 + maxAltitude.time.getUTCMinutes()).toBeGreaterThan(11 * 60 + 20);
      expect(maxAltitude.time.getUTCHours() * 60 + maxAltitude.time.getUTCMinutes()).toBeLessThan(11 * 60 + 55);
    }
  });

  it('rises in the north-east in June', () => {
    const { windows } = computeDayLight(bern, utcDay('2026-06-21'), noGeom, DEFAULT_LIGHT_SETTINGS);
    const morningGolden = windows.find((w) => w.kind === 'golden' && w.period === 'morning');
    expect(morningGolden).toBeDefined();
    expect(morningGolden!.mid.azimuthDeg).toBeGreaterThan(48);
    expect(morningGolden!.mid.azimuthDeg).toBeLessThan(62);
    // Golden hour around sunrise (~03:35 UTC).
    expect(morningGolden!.start.getUTCHours()).toBe(3);
  });

  it('computes 20 spots × 5 days within 1 s (SPEC N2)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      const sun = sunAt(46.9 + i * 0.01, 7.4);
      for (let d = 0; d < 5; d++) {
        computeDayLight(sun, utcDay(`2026-10-${String(16 + d).padStart(2, '0')}`), { axisDeg: i * 9, minSunAltDeg: 5 }, DEFAULT_LIGHT_SETTINGS);
      }
    }
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('horizon profile', () => {
  const eastWest = { axisDeg: 90, minSunAltDeg: 0 };
  // 12° high buildings to the east (60–120°), open elsewhere.
  const deg = Array.from({ length: 360 }, (_, i) => (i >= 60 && i <= 120 ? 12 : 0));

  it('delays the along window until the sun clears the eastern buildings', () => {
    const open = computeDayLight(fakeSun, DAY, eastWest, DEFAULT_LIGHT_SETTINGS);
    const blocked = computeDayLight(fakeSun, DAY, { ...eastWest, horizon: { deg } }, DEFAULT_LIGHT_SETTINGS);
    const first = (d: typeof open) => d.windows.find((w) => w.kind === 'along')!;
    expect(span(first(open))[0]).toBeCloseTo(5 + 1 / 3, 2);
    // Sun reaches 12° when 40 − 5·(12 − h) = 12, i.e. h = 6.4; the window still ends at 6.67 h.
    expect(span(first(blocked))[0]).toBeCloseTo(6.4, 2);
    expect(span(first(blocked))[1]).toBeCloseTo(6 + 2 / 3, 2);
    // Evening along window (west) is unaffected.
    expect(ofKind(blocked.windows, 'along')).toHaveLength(2);
  });

  it('sunVisible respects both the manual minimum and the profile', () => {
    const geom = { axisDeg: null, minSunAltDeg: 5, horizon: { deg } };
    expect(sunVisible({ azimuthDeg: 90, altitudeDeg: 10 }, geom)).toBe(false);
    expect(sunVisible({ azimuthDeg: 90, altitudeDeg: 13 }, geom)).toBe(true);
    expect(sunVisible({ azimuthDeg: 200, altitudeDeg: 4 }, geom)).toBe(false);
    expect(sunVisible({ azimuthDeg: 200, altitudeDeg: 6 }, geom)).toBe(true);
  });
});
