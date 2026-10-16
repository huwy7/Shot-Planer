import { compassLabel } from '../lib/angles';
import type { DayLight, LightWindow, WindowKind } from '../lib/light';
import type { Spot } from '../lib/spot';
import { shadowFactor, type SunPos } from '../lib/sun';
import { renderDayChart } from './dayChart';
import { button, el, formatDeg } from './dom';

export const DAYS_AHEAD = 5;

const time = new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' });

const KIND_LABEL: Record<WindowKind, string> = { blue: 'Blau', golden: 'Gold', along: 'Entlang', across: 'Quer' };

export function dayLabel(dayStart: Date, index: number): string {
  if (index === 0) return 'Heute';
  if (index === 1) return 'Morgen';
  return weekday.format(dayStart);
}

function formatShadow(altitudeDeg: number): string | null {
  const f = shadowFactor(altitudeDeg);
  return f === null ? null : `Schatten ${f.toLocaleString('de-CH', { maximumFractionDigits: f < 10 ? 1 : 0 })}×`;
}

export function describeSun(pos: SunPos): string {
  return [`${formatDeg(Math.round(pos.altitudeDeg))} hoch aus ${compassLabel(pos.azimuthDeg)}`, formatShadow(pos.altitudeDeg)]
    .filter(Boolean)
    .join(' · ');
}

const signed = (deg: number): string => (deg < 0 ? `−${-deg}` : String(deg));

function windowDetail(w: LightWindow): string {
  const [lo, hi] = w.altitudeRange.map((a) => Math.round(a));
  const parts = [`Sonne ${lo === hi ? `${signed(lo)}°` : `${signed(lo)} bis ${signed(hi)}°`}`, `aus ${compassLabel(w.mid.azimuthDeg)}`];
  // Near the horizon the shadow factor explodes and says nothing; only axis windows get it.
  const shadow = w.kind === 'along' || w.kind === 'across' ? formatShadow(w.mid.altitudeDeg) : null;
  if (shadow) parts.push(shadow);
  return parts.join(' · ');
}

export interface DetailView {
  spot: Spot;
  dayIndex: number;
  day: DayLight;
  now: Date;
  selected: number | null;
  /** Sun direction drawn on the map, with its caption. */
  ray: { pos: SunPos; caption: string } | null;
}

export interface DetailHandlers {
  onDay: (index: number) => void;
  onSelect: (index: number | null) => void;
  onEdit: () => void;
  onClose: () => void;
}

/** Bottom sheet showing a spot's light windows for one day. */
export class DetailSheet {
  readonly root = el('section', { class: 'sheet', hidden: true, 'aria-label': 'Licht am Spot' });

  constructor(private readonly handlers: DetailHandlers) {}

  open(view: DetailView): void {
    this.root.hidden = false;
    this.render(view);
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(v: DetailView): void {
    const { spot, day, handlers } = { ...v, handlers: this.handlers };

    const days = el('div', { class: 'chips', role: 'tablist' });
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const start = new Date(day.dayStart.getFullYear(), day.dayStart.getMonth(), day.dayStart.getDate() - v.dayIndex + i);
      const chip = button(dayLabel(start, i), () => handlers.onDay(i), 'chip');
      chip.setAttribute('aria-selected', String(i === v.dayIndex));
      days.append(chip);
    }

    const list = el('ul', { class: 'window-list' });
    if (day.windows.length === 0) list.append(el('li', { class: 'muted' }, 'Keine Lichtfenster an diesem Tag.'));
    day.windows.forEach((w, i) => {
      const item = el(
        'button',
        { type: 'button', class: `window-item kind-${w.kind}`, 'aria-pressed': String(v.selected === i) },
        el('span', { class: `dot dot-${w.kind}`, 'aria-hidden': 'true' }),
        el(
          'span',
          { class: 'window-text' },
          el('span', { class: 'window-head' }, el('strong', {}, `${time.format(w.start)}–${time.format(w.end)}`), ` ${KIND_LABEL[w.kind]}`),
          el('span', {}, w.label),
          el('span', { class: 'muted' }, windowDetail(w)),
        ),
      );
      item.addEventListener('click', () => handlers.onSelect(v.selected === i ? null : i));
      list.append(el('li', {}, item));
    });

    const noon = day.maxAltitude;
    const summary = [`Höchster Sonnenstand ${time.format(noon.time)}: ${formatDeg(Math.round(noon.altitudeDeg))}`, formatShadow(noon.altitudeDeg)]
      .filter(Boolean)
      .join(' · ');

    const parts: (Node | null)[] = [
      el(
        'div',
        { class: 'row' },
        el('h2', { class: 'grow' }, spot.name),
        button('Bearbeiten', handlers.onEdit, 'btn'),
        button('✕', handlers.onClose, 'btn square'),
      ),
      days,
      renderDayChart(day, v.now),
      el(
        'p',
        { class: 'legend' },
        el('span', { class: 'dot dot-blue' }),
        ' Blau ',
        el('span', { class: 'dot dot-golden' }),
        ' Gold ',
        el('span', { class: 'dot dot-along' }),
        ' Entlang ',
        el('span', { class: 'dot dot-across' }),
        ' Quer',
      ),
      el('p', { class: 'hint' }, summary),
      spot.axisDeg === null ? el('p', { class: 'hint warn' }, 'Keine Strassenachse gesetzt: Entlang/Quer fehlen. Unter «Bearbeiten» ziehen.') : null,
      v.ray ? el('p', { class: 'hint' }, `Gelber Strahl auf der Karte: ${v.ray.caption}`) : null,
      list,
    ];
    this.root.replaceChildren(...parts.filter((p): p is Node => p !== null));
  }
}
