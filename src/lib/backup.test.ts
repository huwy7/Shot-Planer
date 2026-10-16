import { describe, expect, it } from 'vitest';
import { BackupError, backupFileName, createBackup, mergeSpots, parseBackup } from './backup';
import { createSpot } from './spot';

const T1 = new Date('2026-10-16T10:00:00.000Z');
const T2 = new Date('2026-10-17T10:00:00.000Z');
const spot = (id: string, name: string, at = T1) => createSpot({ name, lat: 46.95, lon: 7.45 }, at, id);

describe('createBackup / parseBackup', () => {
  it('round-trips spots', () => {
    const spots = [spot('a', 'Kramgasse'), spot('b', 'Marktgasse')];
    const text = JSON.stringify(createBackup(spots, T1));
    expect(parseBackup(text)).toEqual({ spots, rejected: 0 });
  });

  it('names the file by date', () => {
    expect(backupFileName(T1)).toBe('shot-planer-2026-10-16.json');
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError);
    expect(() => parseBackup('[]')).toThrow('Keine Shot-Planer-Sicherung.');
    expect(() => parseBackup(JSON.stringify({ format: 'other', version: 1, spots: [] }))).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ format: 'shot-planer-backup', version: 1 }))).toThrow(BackupError);
  });

  it('rejects backups from a newer version', () => {
    const text = JSON.stringify({ format: 'shot-planer-backup', version: 2, spots: [] });
    expect(() => parseBackup(text)).toThrow('neueren App-Version');
  });

  it('skips and counts invalid entries', () => {
    const text = JSON.stringify({ ...createBackup([spot('a', 'Kramgasse')], T1), spots: [spot('a', 'Kramgasse'), { id: 'x' }, 42] });
    const parsed = parseBackup(text);
    expect(parsed.spots.map((s) => s.id)).toEqual(['a']);
    expect(parsed.rejected).toBe(2);
  });

  it('keeps the newer duplicate within one file', () => {
    const text = JSON.stringify(createBackup([spot('a', 'Alt', T1), spot('a', 'Neu', T2)], T2));
    const parsed = parseBackup(text);
    expect(parsed.spots.map((s) => s.name)).toEqual(['Neu']);
    expect(parsed.rejected).toBe(1);
  });
});

describe('mergeSpots', () => {
  it('adds new, updates newer, keeps older or equal', () => {
    const existing = [spot('a', 'A lokal', T2), spot('b', 'B lokal', T1), spot('c', 'C lokal', T1)];
    const incoming = [spot('a', 'A alt', T1), spot('b', 'B neu', T2), spot('c', 'C gleich', T1), spot('d', 'D', T1)];
    const r = mergeSpots(existing, incoming);
    expect(r.toWrite.map((s) => s.name)).toEqual(['B neu', 'D']);
    expect(r).toMatchObject({ added: 1, updated: 1, unchanged: 2 });
  });
});
