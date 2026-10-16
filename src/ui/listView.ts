import type { RankedWindow } from '../lib/score';
import { sortByName, type Spot } from '../lib/spot';
import { dayLabel, formatRange, KIND_LABEL, scoreBadge } from './detailSheet';
import { button, el, formatDeg } from './dom';

export type ListSort = 'next' | 'name';

export interface ListEntry {
  spot: Spot;
  /** Next green window (F13), or null. */
  next: RankedWindow | null;
}

export interface ListHandlers {
  onSelect: (id: string) => void;
  onSort: (sort: ListSort) => void;
}

/** F13: spots sorted by their next good window; spots without one go last, by name. */
export function sortEntries(entries: readonly ListEntry[], sort: ListSort): ListEntry[] {
  const byName = sortByName(entries.map((e) => e.spot));
  const rank = new Map(byName.map((s, i) => [s.id, i]));
  return [...entries].sort((a, b) => {
    if (sort === 'next') {
      const ta = a.next?.window.start.getTime() ?? Infinity;
      const tb = b.next?.window.start.getTime() ?? Infinity;
      if (ta !== tb) return ta - tb;
    }
    return (rank.get(a.spot.id) ?? 0) - (rank.get(b.spot.id) ?? 0);
  });
}

export function renderSpotList(target: HTMLElement, entries: readonly ListEntry[], sort: ListSort, now: Date, handlers: ListHandlers): void {
  target.replaceChildren();
  target.append(el('h1', {}, `Spots (${entries.length})`));
  if (entries.length === 0) {
    target.append(el('p', { class: 'muted' }, 'Noch keine Spots. Auf der Karte mit «+ Spot» anlegen.'));
    return;
  }

  const chips = el('div', { class: 'chips', role: 'tablist' });
  for (const [id, label] of [
    ['next', 'Nächstes gutes Fenster'],
    ['name', 'A–Z'],
  ] as const) {
    const chip = button(label, () => handlers.onSort(id), 'chip');
    chip.setAttribute('aria-selected', String(sort === id));
    chips.append(chip);
  }
  target.append(chips);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const list = el('ul', { class: 'spot-list' });
  for (const { spot, next } of sortEntries(entries, sort)) {
    const details = [
      spot.axisDeg === null ? 'keine Achse' : `Achse ${formatDeg(spot.axisDeg)}`,
      spot.minSunAltDeg > 0 ? `Sonne ab ${formatDeg(spot.minSunAltDeg)}` : null,
    ].filter(Boolean);
    const nextLine = next
      ? el(
          'span',
          { class: 'next-good' },
          scoreBadge(next),
          ` ${dayLabel(new Date(today.getFullYear(), today.getMonth(), today.getDate() + next.dayIndex), next.dayIndex)} ${formatRange(next.window)} · ${KIND_LABEL[next.window.kind]}`,
        )
      : el('span', { class: 'muted' }, 'Kein grünes Fenster in 5 Tagen');
    const item = el(
      'button',
      { type: 'button', class: 'spot-item' },
      el('span', { class: 'spot-name' }, spot.name),
      nextLine,
      el('span', { class: 'muted' }, details.join(' · ')),
      spot.note ? el('span', { class: 'spot-note' }, spot.note) : '',
    );
    item.addEventListener('click', () => handlers.onSelect(spot.id));
    list.append(el('li', {}, item));
  }
  target.append(list);
}
