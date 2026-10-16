import { angularDiff, axisDiff, compassLabel, normalizeDeg } from './angles';
import type { SunFn, SunPos } from './sun';

export interface LightSettings {
  /** Allowed deviation from parallel / perpendicular, degrees (SPEC F6). */
  toleranceDeg: number;
  /** Above this altitude no light falls along the street, degrees (SPEC F6). */
  maxAltitudeDeg: number;
}

export const DEFAULT_LIGHT_SETTINGS: LightSettings = { toleranceDeg: 10, maxAltitudeDeg: 20 };
export const LIGHT_SETTINGS_RANGE = {
  toleranceDeg: { min: 1, max: 30 },
  maxAltitudeDeg: { min: 5, max: 60 },
} as const;

export const GOLDEN_HOUR = { min: -4, max: 6 } as const;
export const BLUE_HOUR = { min: -6, max: -4 } as const;

export type WindowKind = 'blue' | 'golden' | 'along' | 'across';

export interface LightWindow {
  kind: WindowKind;
  start: Date;
  end: Date;
  /** Before or after the day's highest sun. */
  period: 'morning' | 'evening';
  /** Sun position at the window's middle. */
  mid: SunPos;
  altitudeRange: [number, number];
  /** German description, e.g. "Licht die Gasse entlang aus O". */
  label: string;
}

export interface DayLight {
  dayStart: Date;
  dayEnd: Date;
  /** Sampled sun positions over the day, for charts. */
  samples: { time: Date; pos: SunPos }[];
  maxAltitude: { time: Date; altitudeDeg: number };
  windows: LightWindow[];
}

export interface SpotGeometry {
  axisDeg: number | null;
  minSunAltDeg: number;
}

const SAMPLE_STEP_MS = 2 * 60 * 1000;
const BOUNDARY_PRECISION_MS = 10 * 1000;

export function clampLightSettings(s: Partial<LightSettings> | undefined): LightSettings {
  const clamp = (v: unknown, r: { min: number; max: number }, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, Math.round(v))) : d;
  return {
    toleranceDeg: clamp(s?.toleranceDeg, LIGHT_SETTINGS_RANGE.toleranceDeg, DEFAULT_LIGHT_SETTINGS.toleranceDeg),
    maxAltitudeDeg: clamp(s?.maxAltitudeDeg, LIGHT_SETTINGS_RANGE.maxAltitudeDeg, DEFAULT_LIGHT_SETTINGS.maxAltitudeDeg),
  };
}

/** Local calendar day containing `date` (device time zone; handles DST days of 23/25 h). */
export function localDay(date: Date, offsetDays = 0): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays + 1);
  return { start, end };
}

type Predicate = (pos: SunPos) => boolean;

/** Bisects the time where `inside` flips between t0 (state a) and t1. */
function refineBoundary(sun: SunFn, inside: Predicate, t0: number, t1: number, a: boolean): number {
  while (t1 - t0 > BOUNDARY_PRECISION_MS) {
    const mid = (t0 + t1) / 2;
    if (inside(sun(new Date(mid))) === a) t0 = mid;
    else t1 = mid;
  }
  return Math.round((t0 + t1) / 2);
}

/** Time ranges within the samples where `inside` holds; boundaries refined to ~10 s. */
export function findRanges(
  sun: SunFn,
  samples: readonly { time: Date; pos: SunPos }[],
  inside: Predicate,
): [number, number][] {
  const ranges: [number, number][] = [];
  let openAt: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].time.getTime();
    const now = inside(samples[i].pos);
    if (i === 0) {
      if (now) openAt = t;
      continue;
    }
    const prevT = samples[i - 1].time.getTime();
    const prev = openAt !== null;
    if (now !== prev) {
      const edge = refineBoundary(sun, inside, prevT, t, prev);
      if (now) openAt = edge;
      else {
        ranges.push([openAt as number, edge]);
        openAt = null;
      }
    }
  }
  if (openAt !== null) ranges.push([openAt, samples[samples.length - 1].time.getTime()]);
  return ranges;
}

export function sampleDay(sun: SunFn, start: Date, end: Date): { time: Date; pos: SunPos }[] {
  const samples: { time: Date; pos: SunPos }[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += SAMPLE_STEP_MS) {
    const time = new Date(t);
    samples.push({ time, pos: sun(time) });
  }
  // Include the exact end so windows reaching midnight close there.
  samples.push({ time: new Date(end.getTime()), pos: sun(end) });
  return samples;
}

const inAltitude =
  (min: number, max: number): Predicate =>
  (p) =>
    p.altitudeDeg >= min && p.altitudeDeg <= max;

function axisPredicates(geom: SpotGeometry, settings: LightSettings): { along: Predicate; across: Predicate } | null {
  if (geom.axisDeg === null) return null;
  const axis = geom.axisDeg;
  const altOk = inAltitude(Math.max(geom.minSunAltDeg, 0), settings.maxAltitudeDeg);
  return {
    along: (p) => altOk(p) && axisDiff(p.azimuthDeg, axis) <= settings.toleranceDeg,
    across: (p) => altOk(p) && axisDiff(p.azimuthDeg, axis) >= 90 - settings.toleranceDeg,
  };
}

/** The street side facing the sun when it stands across the axis: the facade normal closest to the sun. */
export function litFacadeDirection(axisDeg: number, sunAzimuthDeg: number): number {
  const a = normalizeDeg(axisDeg + 90);
  const b = normalizeDeg(axisDeg - 90);
  return angularDiff(sunAzimuthDeg, a) <= angularDiff(sunAzimuthDeg, b) ? a : b;
}

function labelFor(kind: WindowKind, mid: SunPos, geom: SpotGeometry): string {
  switch (kind) {
    case 'blue':
      return 'Blaue Stunde';
    case 'golden':
      return 'Goldene Stunde';
    case 'along':
      return `Licht die Gasse entlang aus ${compassLabel(mid.azimuthDeg)}, Streiflicht auf Fassaden`;
    case 'across': {
      const side = compassLabel(litFacadeDirection(geom.axisDeg ?? 0, mid.azimuthDeg));
      return `Frontallicht auf Fassaden Richtung ${side}, Schattenkante über die Gasse`;
    }
  }
}

/** All light windows of one local day for a spot. Pure apart from the injected sun function. */
export function computeDayLight(sun: SunFn, day: { start: Date; end: Date }, geom: SpotGeometry, settings: LightSettings): DayLight {
  const samples = sampleDay(sun, day.start, day.end);
  let max = samples[0];
  for (const s of samples) if (s.pos.altitudeDeg > max.pos.altitudeDeg) max = s;
  const noon = max.time.getTime();

  const predicates: [WindowKind, Predicate][] = [
    ['blue', (p) => p.altitudeDeg >= BLUE_HOUR.min && p.altitudeDeg < BLUE_HOUR.max],
    ['golden', inAltitude(GOLDEN_HOUR.min, GOLDEN_HOUR.max)],
  ];
  const axis = axisPredicates(geom, settings);
  if (axis) predicates.push(['along', axis.along], ['across', axis.across]);

  const windows: LightWindow[] = [];
  for (const [kind, inside] of predicates) {
    for (const [start, end] of findRanges(sun, samples, inside)) {
      if (end <= start) continue;
      const midTime = new Date((start + end) / 2);
      const mid = sun(midTime);
      // Mid included: a window can span the day's highest sun (e.g. winter with a high max altitude).
      const alts = [sun(new Date(start)).altitudeDeg, mid.altitudeDeg, sun(new Date(end)).altitudeDeg];
      windows.push({
        kind,
        start: new Date(start),
        end: new Date(end),
        period: midTime.getTime() < noon ? 'morning' : 'evening',
        mid,
        altitudeRange: [Math.min(...alts), Math.max(...alts)],
        label: labelFor(kind, mid, geom),
      });
    }
  }
  windows.sort((a, b) => a.start.getTime() - b.start.getTime() || a.kind.localeCompare(b.kind));
  return {
    dayStart: day.start,
    dayEnd: day.end,
    samples,
    maxAltitude: { time: max.time, altitudeDeg: max.pos.altitudeDeg },
    windows,
  };
}
