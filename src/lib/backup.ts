import { parseSpot, type Spot } from './spot';

export const BACKUP_FORMAT = 'shot-planer-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  spots: Spot[];
}

export function createBackup(spots: readonly Spot[], now: Date): Backup {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), spots: [...spots] };
}

export function backupFileName(now: Date): string {
  return `shot-planer-${now.toISOString().slice(0, 10)}.json`;
}

export class BackupError extends Error {}

export interface ParsedBackup {
  spots: Spot[];
  rejected: number;
}

/** Parses backup file text. Throws BackupError when the file is not a usable backup at all. */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('Datei ist kein gültiges JSON.');
  }
  if (typeof data !== 'object' || data === null) throw new BackupError('Unbekanntes Dateiformat.');
  const d = data as Record<string, unknown>;
  if (d.format !== BACKUP_FORMAT) throw new BackupError('Keine Shot-Planer-Sicherung.');
  if (typeof d.version !== 'number' || d.version > BACKUP_VERSION) {
    throw new BackupError('Sicherung stammt aus einer neueren App-Version.');
  }
  if (!Array.isArray(d.spots)) throw new BackupError('Sicherung enthält keine Spots.');

  const byId = new Map<string, Spot>();
  let rejected = 0;
  for (const raw of d.spots) {
    const spot = parseSpot(raw);
    if (!spot) {
      rejected++;
      continue;
    }
    const prev = byId.get(spot.id);
    if (prev) rejected++;
    if (!prev || spot.updatedAt > prev.updatedAt) byId.set(spot.id, spot);
  }
  return { spots: [...byId.values()], rejected };
}

export interface MergeResult {
  toWrite: Spot[];
  added: number;
  updated: number;
  unchanged: number;
}

/** Merges imported spots into existing ones by id; the newer updatedAt wins. Nothing is deleted. */
export function mergeSpots(existing: readonly Spot[], incoming: readonly Spot[]): MergeResult {
  const current = new Map(existing.map((s) => [s.id, s]));
  const result: MergeResult = { toWrite: [], added: 0, updated: 0, unchanged: 0 };
  for (const spot of incoming) {
    const prev = current.get(spot.id);
    if (!prev) {
      result.toWrite.push(spot);
      result.added++;
    } else if (spot.updatedAt > prev.updatedAt) {
      result.toWrite.push(spot);
      result.updated++;
    } else {
      result.unchanged++;
    }
  }
  return result;
}
