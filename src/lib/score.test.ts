import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHT_SETTINGS, type LightWindow, type WindowKind } from './light';
import { ampelFor, hourlyScores, nextGood, planSpot, scoreWindow, topWindows, type ScoredDay, type SpotPlan } from './score';
import type { SunFn } from './sun';
import type { HourWeather } from './weather';

const at = (h: number) => new Date(Date.UTC(2026, 9, 16, h));

function win(kind: WindowKind, startH: number, endH: number, alt: [number, number] = [2, 10], period: 'morning' | 'evening' = 'morning'): LightWindow {
  return { kind, start: at(startH), end: at(endH), period, mid: { azimuthDeg: 90, altitudeDeg: alt[1] }, altitudeRange: alt, label: kind };
}

function wx(low: number, mid: number, high: number): HourWeather {
  return { time: 0, cloudCover: null, cloudLow: low, cloudMid: mid, cloudHigh: high, precipitation: 0, visibility: 20000, humidity: 70, windGusts: 10 };
}

const HARD = wx(5, 5, 10);
const MIXED = wx(40, 10, 10);
const SOFT = wx(90, 50, 50);

describe('ampelFor', () => {
  it('uses 70 / 45', () => {
    expect([ampelFor(100), ampelFor(70), ampelFor(69), ampelFor(45), ampelFor(44), ampelFor(0)]).toEqual([
      'green', 'green', 'yellow', 'yellow', 'red', 'red',
    ]);
  });
});

describe('scoreWindow', () => {
  it('scores along in golden hour with hard light as 100', () => {
    const s = scoreWindow(win('along', 7, 8, [0, 12]), HARD);
    expect(s.score).toBe(100);
    expect(s.reasons.map((r) => r.text)).toEqual(['Licht die Gasse entlang', 'warmes, tiefes Licht', 'direkte Sonne']);
  });

  it('drops along to red when overcast', () => {
    const s = scoreWindow(win('along', 7, 8, [0, 12]), SOFT);
    expect(s.score).toBe(35);
    expect(s.ampel).toBe('red');
  });

  it('gives no golden bonus to axis windows entirely above 6°', () => {
    expect(scoreWindow(win('across', 9, 10, [8, 18]), HARD).score).toBe(70);
  });

  it('adds +10 for mixed light', () => {
    expect(scoreWindow(win('golden', 7, 8, [-4, 6]), MIXED).score).toBe(45);
  });

  it('rates blue hour by its own rules', () => {
    expect(scoreWindow(win('blue', 6, 7, [-6, -4]), HARD).score).toBe(45);
    expect(scoreWindow(win('blue', 6, 7, [-6, -4]), SOFT).score).toBe(30);
  });

  it('adds the afterglow chance for golden hour with mid-high clouds and clear low sky', () => {
    const s = scoreWindow(win('golden', 18, 19, [-4, 6], 'evening'), wx(10, 10, 50));
    expect(s.reasons.at(-1)).toEqual({ points: 10, text: 'Chance auf Abendrot' });
    expect(s.score).toBe(80);
    expect(scoreWindow(win('golden', 6, 7, [-4, 6]), wx(10, 10, 50)).reasons.at(-1)?.text).toBe('Chance auf Morgenrot');
    expect(scoreWindow(win('golden', 18, 19, [-4, 6]), wx(10, 10, 80)).reasons.some((r) => r.text.includes('Abendrot'))).toBe(false);
  });

  it('keeps the base score without weather', () => {
    const s = scoreWindow(win('along', 9, 10, [8, 15]), null);
    expect(s.score).toBe(50);
    expect(s.reasons.at(-1)?.text).toBe('ohne Wetter');
    expect(scoreWindow(win('along', 9, 10, [8, 15]), { ...HARD, cloudLow: null }).score).toBe(50);
  });

  it('adds the wet-street bonus, more for blue hour', () => {
    expect(scoreWindow(win('along', 9, 10, [8, 15]), MIXED, true).reasons.at(-1)).toEqual({ points: 15, text: 'nasse Strasse, Spiegelungen' });
    expect(scoreWindow(win('blue', 6, 7, [-6, -4]), SOFT, true).score).toBe(50);
    expect(scoreWindow(win('along', 7, 8, [0, 12]), HARD, true).score).toBe(100);
  });

  it('replaces the weather bonus when buildings hide the sun in golden hour', () => {
    const s = scoreWindow(win('golden', 7, 8, [-4, 6]), HARD, false, true);
    expect(s.reasons.map((r) => [r.text, r.points])).toEqual([
      ['Goldene Stunde', 35],
      ['Sonne hinter Gebäuden', -20],
    ]);
    expect(s.score).toBe(15);
  });

  it('never leaves 0..100', () => {
    expect(scoreWindow(win('blue', 6, 7), null).score).toBeGreaterThanOrEqual(0);
  });
});

const day = (scored: ReturnType<typeof scoreWindow>[], dayIndex = 0): ScoredDay => ({
  dayIndex,
  day: { dayStart: at(0), dayEnd: at(24), samples: [], maxAltitude: { time: at(12), altitudeDeg: 30 }, windows: scored.map((s) => s.window) },
  scored,
  motifs: [],
});

describe('ranking', () => {
  const plan: SpotPlan = {
    days: [
      day([scoreWindow(win('golden', 6, 7, [-4, 6]), MIXED), scoreWindow(win('along', 8, 9, [5, 12]), HARD), scoreWindow(win('across', 15, 16, [10, 18]), HARD)]),
    ],
  };

  it('ranks top windows by score, then start', () => {
    expect(topWindows(plan, at(0)).map((w) => [w.window.kind, w.score])).toEqual([
      ['along', 100],
      ['across', 70],
      ['golden', 45],
    ]);
  });

  it('skips windows that already ended', () => {
    expect(topWindows(plan, at(10)).map((w) => w.window.kind)).toEqual(['across']);
    expect(topWindows(plan, at(8.5)).map((w) => w.window.kind)).toContain('along');
  });

  it('finds the next green window', () => {
    expect(nextGood(plan, at(0))?.window.kind).toBe('along');
    expect(nextGood(plan, at(9))?.window.kind).toBe('across');
    expect(nextGood(plan, at(17))).toBeNull();
  });

  it('prefers a better window overlapping the earliest green one', () => {
    const overlap: SpotPlan = {
      days: [day([scoreWindow(win('golden', 6, 8, [-4, 6]), wx(10, 10, 50)), scoreWindow(win('along', 7, 9, [2, 12]), HARD), scoreWindow(win('along', 15, 16, [2, 12]), HARD)])],
    };
    expect(overlap.days[0].scored.map((s) => s.score)).toEqual([80, 100, 100]);
    expect(nextGood(overlap, at(0))?.window.start).toEqual(at(7));
  });

  it('derives hourly scores from overlapping windows', () => {
    const hours = hourlyScores(plan.days[0]);
    expect(hours).toHaveLength(24);
    expect(hours[6].score).toBe(45);
    expect(hours[8].score).toBe(100);
    expect(hours[12].score).toBe(0);
  });
});

describe('planSpot', () => {
  it('scores every window of every day', () => {
    const start = new Date(2026, 9, 16).getTime();
    const sun: SunFn = (d) => {
      const h = ((d.getTime() - start) / 3600000) % 24;
      return { azimuthDeg: 180 + 15 * (h - 12), altitudeDeg: 40 - 5 * Math.abs(h - 12) };
    };
    const plan = planSpot(sun, { axisDeg: 90, minSunAltDeg: 0 }, DEFAULT_LIGHT_SETTINGS, undefined, new Date(2026, 9, 16, 1), 2);
    expect(plan.days).toHaveLength(2);
    expect(plan.days[0].scored.length).toBe(plan.days[0].day.windows.length);
    expect(plan.days[0].scored.every((s) => s.reasons.some((r) => r.text === 'ohne Wetter'))).toBe(true);
    expect(plan.days[0].motifs).toEqual([]);
  });
});

describe('planSpot motifs', () => {
  it('assigns rain to the local day it falls in, not the next one', () => {
    const sun: SunFn = () => ({ azimuthDeg: 0, altitudeDeg: -30 });
    const now = new Date(2026, 9, 16, 12);
    const midnight = new Date(2026, 9, 17).getTime();
    const H = 3600 * 1000;
    // Rain stamped at 23:00 and 00:00 covers 22–23 and 23–24 on the 16th; 01:00 covers 00–01 on the 17th.
    const hours: HourWeather[] = [-1, 0, 1].map((k) => ({ ...HARD, time: midnight + k * H, precipitation: 2 }));
    const plan = planSpot(sun, { axisDeg: null, minSunAltDeg: 0 }, DEFAULT_LIGHT_SETTINGS, hours, now, 2);
    const span = (d: number) => plan.days[d].motifs.filter((m) => m.kind === 'rain').map((m) => [(m.start.getTime() - midnight) / H, (m.end.getTime() - midnight) / H]);
    expect(span(0)).toEqual([[-2, 0]]);
    expect(span(1)).toEqual([[0, 1]]);
  });
});
