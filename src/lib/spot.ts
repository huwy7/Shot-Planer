import { normalizeAxis } from './angles';

export interface Spot {
  id: string;
  name: string;
  note: string;
  lat: number;
  lon: number;
  /** Street axis in [0, 180), or null when not set. */
  axisDeg: number | null;
  /** Minimum sun altitude in degrees at which the sun clears the buildings (SPEC F3a). */
  minSunAltDeg: number;
  createdAt: string;
  updatedAt: string;
}

export const MIN_SUN_ALT_RANGE = { min: 0, max: 60 } as const;
export const NAME_MAX_LENGTH = 80;
export const NOTE_MAX_LENGTH = 2000;

export interface SpotInput {
  name: string;
  note?: string;
  lat: number;
  lon: number;
  axisDeg?: number | null;
  minSunAltDeg?: number;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** Normalizes an axis input; returns null for "no axis". */
export function cleanAxis(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  // Round to 0.1° so repeated edits do not accumulate float noise.
  return Math.round(normalizeAxis(value) * 10) / 10 % 180;
}

export function clampMinSunAlt(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(MIN_SUN_ALT_RANGE.max, Math.max(MIN_SUN_ALT_RANGE.min, Math.round(value)));
}

/** Returns a German error message for invalid input, or null when valid. */
export function validateSpotInput(input: SpotInput): string | null {
  if (input.name.trim().length === 0) return 'Name fehlt.';
  if (input.name.trim().length > NAME_MAX_LENGTH) return `Name ist länger als ${NAME_MAX_LENGTH} Zeichen.`;
  if ((input.note ?? '').length > NOTE_MAX_LENGTH) return `Notiz ist länger als ${NOTE_MAX_LENGTH} Zeichen.`;
  if (!isFiniteNumber(input.lat) || input.lat < -90 || input.lat > 90) return 'Ungültige Breite.';
  if (!isFiniteNumber(input.lon) || input.lon < -180 || input.lon > 180) return 'Ungültige Länge.';
  return null;
}

export function createSpot(input: SpotInput, now: Date, id: string = crypto.randomUUID()): Spot {
  const ts = now.toISOString();
  return {
    id,
    name: input.name.trim(),
    note: (input.note ?? '').trim(),
    lat: input.lat,
    lon: input.lon,
    axisDeg: cleanAxis(input.axisDeg),
    minSunAltDeg: clampMinSunAlt(input.minSunAltDeg),
    createdAt: ts,
    updatedAt: ts,
  };
}

export function updateSpot(spot: Spot, input: SpotInput, now: Date): Spot {
  return {
    ...createSpot(input, now, spot.id),
    createdAt: spot.createdAt,
  };
}

/** Parses an untrusted object (e.g. from a backup file) into a Spot, or null when invalid. */
export function parseSpot(raw: unknown): Spot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100) return null;
  if (typeof r.name !== 'string') return null;
  const note = r.note === undefined ? '' : r.note;
  if (typeof note !== 'string') return null;
  if (!isFiniteNumber(r.lat) || !isFiniteNumber(r.lon)) return null;
  if (r.axisDeg !== null && r.axisDeg !== undefined && !isFiniteNumber(r.axisDeg)) return null;
  if (r.minSunAltDeg !== undefined && !isFiniteNumber(r.minSunAltDeg)) return null;
  if (!isIsoDate(r.createdAt) || !isIsoDate(r.updatedAt)) return null;
  const input: SpotInput = {
    name: r.name,
    note,
    lat: r.lat,
    lon: r.lon,
    axisDeg: r.axisDeg as number | null | undefined,
    minSunAltDeg: r.minSunAltDeg as number | undefined,
  };
  if (validateSpotInput(input) !== null) return null;
  return {
    ...createSpot(input, new Date(r.updatedAt), r.id),
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

/** Sorts by name, German collation, case-insensitive. */
export function sortByName(spots: readonly Spot[]): Spot[] {
  return [...spots].sort((a, b) => a.name.localeCompare(b.name, 'de-CH', { sensitivity: 'base' }));
}
