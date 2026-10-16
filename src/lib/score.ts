// Transparent score rules (SPEC §2 "Score-Logik"). Every rule yields points and a German reason.

import { computeDayLight, GOLDEN_HOUR, localDay, type DayLight, type LightSettings, type LightWindow } from './light';
import type { SunFn } from './sun';
import { classifyClouds, motifWindows, weatherAt, wetStreetAt, type HourWeather, type MotifWindow } from './weather';

export type Ampel = 'green' | 'yellow' | 'red';

export const AMPEL_THRESHOLDS = { green: 70, yellow: 45 } as const;

export const SCORE_RULES = {
  base: { along: 50, across: 35, golden: 35, blue: 25 },
  axisInGoldenHour: 15,
  sunWindow: { hard: 35, mixed: 10, soft: -30 },
  blueHour: { hard: 20, mixed: 20, soft: 5 },
  afterglow: 10,
  afterglowHigh: { min: 30, max: 70 },
  afterglowMaxLow: 30,
  /** F8: wet street, dry from above. Blue hour gets more because city lights reflect best then. */
  wetStreet: { default: 15, blue: 20 },
} as const;

export interface ScoreReason {
  points: number;
  text: string;
}

export interface ScoredWindow {
  window: LightWindow;
  score: number;
  ampel: Ampel;
  reasons: ScoreReason[];
  /** Forecast hour used, or null when none was available. */
  weather: HourWeather | null;
}

export function ampelFor(score: number): Ampel {
  if (score >= AMPEL_THRESHOLDS.green) return 'green';
  if (score >= AMPEL_THRESHOLDS.yellow) return 'yellow';
  return 'red';
}

export function scoreWindow(w: LightWindow, weather: HourWeather | null, wetStreet = false): ScoredWindow {
  const r = SCORE_RULES;
  const reasons: ScoreReason[] = [];
  const baseText = {
    along: 'Licht die Gasse entlang',
    across: 'Frontallicht und Schattenkante',
    golden: 'Goldene Stunde',
    blue: 'Blaue Stunde',
  } as const;
  reasons.push({ points: r.base[w.kind], text: baseText[w.kind] });

  const axis = w.kind === 'along' || w.kind === 'across';
  if (axis && w.altitudeRange[0] <= GOLDEN_HOUR.max) {
    reasons.push({ points: r.axisInGoldenHour, text: 'warmes, tiefes Licht' });
  }

  const cls = weather ? classifyClouds(weather) : null;
  if (!weather || !cls) {
    reasons.push({ points: 0, text: 'ohne Wetter' });
  } else if (w.kind === 'blue') {
    const text = { hard: 'klarer Himmel', mixed: 'klarer Himmel mit Wolken', soft: 'bedeckt' }[cls];
    reasons.push({ points: r.blueHour[cls], text });
  } else {
    const text = { hard: 'direkte Sonne', mixed: 'Sonne mit Unterbrüchen', soft: 'bedeckt, kaum direktes Licht' }[cls];
    reasons.push({ points: r.sunWindow[cls], text });
    const high = weather.cloudHigh ?? 0;
    const low = weather.cloudLow ?? 100;
    if (w.kind === 'golden' && high >= r.afterglowHigh.min && high <= r.afterglowHigh.max && low < r.afterglowMaxLow) {
      reasons.push({ points: r.afterglow, text: w.period === 'evening' ? 'Chance auf Abendrot' : 'Chance auf Morgenrot' });
    }
  }

  if (wetStreet) {
    reasons.push({ points: w.kind === 'blue' ? r.wetStreet.blue : r.wetStreet.default, text: 'nasse Strasse, Spiegelungen' });
  }

  const score = Math.max(0, Math.min(100, reasons.reduce((sum, x) => sum + x.points, 0)));
  return { window: w, score, ampel: ampelFor(score), reasons, weather };
}

export function windowMid(w: LightWindow): Date {
  return new Date((w.start.getTime() + w.end.getTime()) / 2);
}

export interface ScoredDay {
  dayIndex: number;
  day: DayLight;
  scored: ScoredWindow[];
  /** F10 rain/wind windows of this day; not part of the score. */
  motifs: MotifWindow[];
}

/** Precipitation forecasts beyond tomorrow are rough; the UI marks them as uncertain. */
export const RELIABLE_PRECIP_DAYS = 2;

export interface SpotPlan {
  days: ScoredDay[];
}

/** Light windows with scores for `days` local days starting today. */
export function planSpot(
  sun: SunFn,
  geom: { axisDeg: number | null; minSunAltDeg: number },
  settings: LightSettings,
  hours: readonly HourWeather[] | undefined,
  now: Date,
  days: number,
): SpotPlan {
  const result: ScoredDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = computeDayLight(sun, localDay(now, i), geom, settings);
    const scored = day.windows.map((w) => scoreWindow(w, weatherAt(hours, windowMid(w)), wetStreetAt(hours, windowMid(w))));
    // Values cover the preceding hour, so the day's hours are those stamped in (dayStart, dayEnd].
    const dayHours = (hours ?? []).filter((h) => h.time > day.dayStart.getTime() && h.time <= day.dayEnd.getTime());
    const motifs = motifWindows(dayHours);
    result.push({ dayIndex: i, day, scored, motifs });
  }
  return { days: result };
}

export interface RankedWindow extends ScoredWindow {
  dayIndex: number;
  index: number;
}

/** All windows that have not ended yet, flattened with their day and position. */
export function upcoming(plan: SpotPlan, now: Date): RankedWindow[] {
  return plan.days.flatMap((d) =>
    d.scored.map((s, index) => ({ ...s, dayIndex: d.dayIndex, index })).filter((s) => s.window.end.getTime() > now.getTime()),
  );
}

/** F12: best windows by score, earlier first on ties. */
export function topWindows(plan: SpotPlan, now: Date, count = 3): RankedWindow[] {
  return upcoming(plan, now)
    .sort((a, b) => b.score - a.score || a.window.start.getTime() - b.window.start.getTime())
    .slice(0, count);
}

/**
 * F13: the next window rated green, or null. Among green windows overlapping the earliest one,
 * the best wins, so a 70 golden hour does not hide a simultaneous 100 along-the-street window.
 */
export function nextGood(plan: SpotPlan, now: Date): RankedWindow | null {
  const green = upcoming(plan, now)
    .filter((s) => s.ampel === 'green')
    .sort((a, b) => a.window.start.getTime() - b.window.start.getTime());
  if (green.length === 0) return null;
  const firstEnd = green[0].window.end.getTime();
  return green.filter((s) => s.window.start.getTime() < firstEnd).reduce((best, s) => (s.score > best.score ? s : best));
}

/** F11: per hour of a day, the best score of windows overlapping that hour (0 when none). */
export function hourlyScores(day: ScoredDay): { start: Date; score: number }[] {
  const out: { start: Date; score: number }[] = [];
  const HOUR = 3600 * 1000;
  for (let t = day.day.dayStart.getTime(); t < day.day.dayEnd.getTime(); t += HOUR) {
    let best = 0;
    for (const s of day.scored) {
      if (s.window.start.getTime() < t + HOUR && s.window.end.getTime() > t) best = Math.max(best, s.score);
    }
    out.push({ start: new Date(t), score: best });
  }
  return out;
}
