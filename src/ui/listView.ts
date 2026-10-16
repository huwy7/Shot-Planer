import { sortByName, type Spot } from '../lib/spot';
import { el, formatDeg } from './dom';

export function renderSpotList(target: HTMLElement, spots: readonly Spot[], onSelect: (id: string) => void): void {
  target.replaceChildren();
  target.append(el('h1', {}, `Spots (${spots.length})`));
  if (spots.length === 0) {
    target.append(el('p', { class: 'muted' }, 'Noch keine Spots. Auf der Karte mit «+ Spot» anlegen.'));
    return;
  }
  const list = el('ul', { class: 'spot-list' });
  for (const spot of sortByName(spots)) {
    const details = [
      spot.axisDeg === null ? 'keine Achse' : `Achse ${formatDeg(spot.axisDeg)}`,
      spot.minSunAltDeg > 0 ? `Sonne ab ${formatDeg(spot.minSunAltDeg)}` : null,
    ].filter(Boolean);
    const item = el(
      'button',
      { type: 'button', class: 'spot-item' },
      el('span', { class: 'spot-name' }, spot.name),
      el('span', { class: 'muted' }, details.join(' · ')),
      spot.note ? el('span', { class: 'spot-note' }, spot.note) : null,
    );
    item.addEventListener('click', () => onSelect(spot.id));
    list.append(el('li', {}, item));
  }
  target.append(list);
}
