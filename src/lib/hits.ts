// F15: hits ("this was good/bad") with the inputs the score saw, for later calibration.

import type { LightSettings, WindowKind } from './light';
import type { SunPos } from './sun';
import type { HourWeather } from './weather';

export type HitRating = 'good' | 'bad';

export interface HitInputs {
  sun: SunPos;
  weather: HourWeather | null;
  /** Windows active at the hit time. */
  activeWindows: { kind: WindowKind; score: number }[];
  /** Best score active at the hit time, or null outside all windows. */
  score: number | null;
  settings: LightSettings;
}

export interface Hit {
  id: string;
  spotId: string;
  time: string;
  rating: HitRating;
  inputs: HitInputs;
}

export function createHit(spotId: string, rating: HitRating, now: Date, inputs: HitInputs, id: string = crypto.randomUUID()): Hit {
  return { id, spotId, time: now.toISOString(), rating, inputs };
}

/** Parses an untrusted hit (from a backup). Inputs are kept as given apart from a shape check. */
export function parseHit(raw: unknown): Hit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100) return null;
  if (typeof r.spotId !== 'string' || r.spotId.length === 0) return null;
  if (typeof r.time !== 'string' || Number.isNaN(Date.parse(r.time))) return null;
  if (r.rating !== 'good' && r.rating !== 'bad') return null;
  if (typeof r.inputs !== 'object' || r.inputs === null) return null;
  return { id: r.id, spotId: r.spotId, time: new Date(r.time).toISOString(), rating: r.rating, inputs: r.inputs as HitInputs };
}
