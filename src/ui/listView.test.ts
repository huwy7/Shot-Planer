import { describe, expect, it } from 'vitest';
import type { RankedWindow } from '../lib/score';
import { createSpot } from '../lib/spot';
import { sortEntries, type ListEntry } from './listView';

const NOW = new Date('2026-10-16T08:00:00Z');
const entry = (name: string, startH: number | null): ListEntry => ({
  spot: createSpot({ name, lat: 46.95, lon: 7.45 }, NOW, name),
  next: startH === null ? null : ({ window: { start: new Date(Date.UTC(2026, 9, 16, startH)) } } as RankedWindow),
});

describe('sortEntries', () => {
  const entries = [entry('Zytglogge', null), entry('Kramgasse', 18), entry('Aarstrasse', null), entry('Bärenplatz', 7)];

  it('sorts by next good window, then name for spots without one', () => {
    expect(sortEntries(entries, 'next').map((e) => e.spot.name)).toEqual(['Bärenplatz', 'Kramgasse', 'Aarstrasse', 'Zytglogge']);
  });

  it('sorts by name on request', () => {
    expect(sortEntries(entries, 'name').map((e) => e.spot.name)).toEqual(['Aarstrasse', 'Bärenplatz', 'Kramgasse', 'Zytglogge']);
  });
});
