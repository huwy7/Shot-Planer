import { compassLabel } from '../lib/angles';
import type { HitRating } from '../lib/hits';
import type { LightWindow, WindowKind } from '../lib/light';
import { RELIABLE_PRECIP_DAYS, type RankedWindow, type ScoredDay, type ScoredWindow } from '../lib/score';
import type { Spot } from '../lib/spot';
import { shadowFactor, type SunPos } from '../lib/sun';
import { describeClouds, type HourWeather, type MotifWindow } from '../lib/weather';
import { renderDayChart } from './dayChart';
import { renderHorizonChart } from './horizonChart';
import { button, el, formatDeg } from './dom';

export const DAYS_AHEAD = 5;

const time = new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' });

export const KIND_LABEL: Record<WindowKind, string> = { blue: 'Blau', golden: 'Gold', along: 'Entlang', across: 'Quer' };

export function dayLabel(dayStart: Date, index: number): string {
  if (index === 0) return 'Heute';
  if (index === 1) return 'Morgen';
  return weekday.format(dayStart);
}

export function formatRange(w: LightWindow): string {
  return `${time.format(w.start)}–${time.format(w.end)}`;
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

/** "Licht die Gasse entlang +50, direkte Sonne +35" */
export function reasonsText(s: ScoredWindow): string {
  return s.reasons.map((r) => (r.points === 0 ? r.text : `${r.text} ${r.points > 0 ? '+' : '−'}${Math.abs(r.points)}`)).join(', ');
}

export const MOTIF_ICON: Record<MotifWindow['kind'], string> = { rain: '☔', wind: '💨' };

export function describeMotif(m: MotifWindow, dayText: string, dayIndex: number): string {
  const what =
    m.kind === 'rain'
      ? `Regen ${dayText} ${time.format(m.start)}–${time.format(m.end)}, bis ${m.peak.toLocaleString('de-CH', { maximumFractionDigits: 1 })} mm/h`
      : `Böen ${dayText} ${time.format(m.start)}–${time.format(m.end)}, bis ${Math.round(m.peak)} km/h`;
  return `${MOTIF_ICON[m.kind]} ${what}${dayIndex >= RELIABLE_PRECIP_DAYS ? ' (unsicher)' : ''}`;
}

export function scoreBadge(s: { score: number; ampel: string }): HTMLElement {
  return el('span', { class: `badge ampel-${s.ampel}`, 'aria-label': `Score ${s.score}` }, String(s.score));
}

export interface DetailView {
  spot: Spot;
  dayIndex: number;
  scoredDay: ScoredDay;
  top: RankedWindow[];
  /** F10 motifs of the shown day that have not ended yet. */
  motifs: MotifWindow[];
  now: Date;
  selected: number | null;
  /** Sun direction drawn on the map, with its caption. */
  ray: { pos: SunPos; caption: string } | null;
  /** Forecast hours of this day (empty when none) and a status line. */
  weather: { hours: HourWeather[]; status: string };
  hitStatus: string;
}

export interface DetailHandlers {
  onDay: (index: number) => void;
  onSelect: (index: number | null) => void;
  onJump: (dayIndex: number, index: number) => void;
  onHit: (rating: HitRating) => void;
  onEdit: () => void;
  onClose: () => void;
}

/** Bottom sheet showing a spot's best windows and its light windows for one day. */
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
    const handlers = this.handlers;
    const { day, scored } = v.scoredDay;
    const dayStartOf = (i: number) => new Date(day.dayStart.getFullYear(), day.dayStart.getMonth(), day.dayStart.getDate() - v.dayIndex + i);

    const top = el('ol', { class: 'top-list' });
    if (v.top.length === 0) top.append(el('li', { class: 'muted' }, 'Keine kommenden Lichtfenster.'));
    for (const t of v.top) {
      const item = el(
        'button',
        { type: 'button', class: 'top-item' },
        scoreBadge(t),
        el(
          'span',
          { class: 'window-text' },
          el('strong', {}, `${dayLabel(dayStartOf(t.dayIndex), t.dayIndex)} ${formatRange(t.window)} · ${KIND_LABEL[t.window.kind]}`),
          el('span', { class: 'muted' }, reasonsText(t)),
        ),
      );
      item.addEventListener('click', () => handlers.onJump(t.dayIndex, t.index));
      top.append(el('li', {}, item));
    }

    const motifs = el('ul', { class: 'motif-list' });
    for (const motif of v.motifs) {
      motifs.append(el('li', {}, describeMotif(motif, dayLabel(dayStartOf(v.dayIndex), v.dayIndex), v.dayIndex)));
    }

    const days = el('div', { class: 'chips', role: 'tablist' });
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const chip = button(dayLabel(dayStartOf(i), i), () => handlers.onDay(i), 'chip');
      chip.setAttribute('aria-selected', String(i === v.dayIndex));
      days.append(chip);
    }

    const list = el('ul', { class: 'window-list' });
    if (scored.length === 0) list.append(el('li', { class: 'muted' }, 'Keine Lichtfenster an diesem Tag.'));
    scored.forEach((s, i) => {
      const w = s.window;
      const item = el(
        'button',
        { type: 'button', class: `window-item kind-${w.kind}`, 'aria-pressed': String(v.selected === i) },
        el('span', { class: `dot dot-${w.kind}`, 'aria-hidden': 'true' }),
        el(
          'span',
          { class: 'window-text' },
          el('span', { class: 'window-head' }, el('strong', {}, formatRange(w)), ` ${KIND_LABEL[w.kind]} `, scoreBadge(s)),
          el('span', {}, w.label),
          el('span', { class: 'muted' }, windowDetail(w)),
          s.weather ? el('span', { class: 'muted' }, describeClouds(s.weather)) : '',
          el('span', { class: 'muted small' }, reasonsText(s)),
        ),
      );
      item.addEventListener('click', () => handlers.onSelect(v.selected === i ? null : i));
      list.append(el('li', {}, item));
    });

    const noon = day.maxAltitude;
    const summary = [`Höchster Sonnenstand ${time.format(noon.time)}: ${formatDeg(Math.round(noon.altitudeDeg))}`, formatShadow(noon.altitudeDeg)]
      .filter(Boolean)
      .join(' · ');

    this.root.replaceChildren(
      el(
        'div',
        { class: 'row' },
        el('h2', { class: 'grow' }, v.spot.name),
        button('Bearbeiten', handlers.onEdit, 'btn'),
        button('✕', handlers.onClose, 'btn square'),
      ),
      el('h3', {}, 'Beste Fenster (5 Tage)'),
      top,
      el(
        'div',
        { class: 'row hit-row' },
        el('span', { class: 'muted grow' }, 'Jetzt vor Ort?'),
        button('👍 War gut', () => handlers.onHit('good'), 'btn'),
        button('👎 War schlecht', () => handlers.onHit('bad'), 'btn'),
      ),
      v.hitStatus ? el('p', { class: 'hint', role: 'status' }, v.hitStatus) : '',
      days,
      renderDayChart(day, v.now, v.weather.hours),
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
        ' Quer · Wolken ',
        el('span', { class: 'dot cloud-hard' }),
        ' hart ',
        el('span', { class: 'dot cloud-mixed' }),
        ' wechselnd ',
        el('span', { class: 'dot cloud-soft' }),
        ' weich ',
        el('span', { class: 'dot wet' }),
        ' nasse Strasse',
      ),
      el('p', { class: 'hint' }, v.weather.status),
      v.motifs.length > 0 ? motifs : '',
      el('p', { class: 'hint' }, summary),
      v.spot.horizon ? el('h3', {}, 'Horizont und Sonnenbahn') : '',
      v.spot.horizon ? renderHorizonChart(v.spot.horizon, day, v.spot) : '',
      v.spot.horizon
        ? el('p', { class: 'hint' }, `Grau: Gebäude, Bäume, Gelände (${v.spot.horizon.source}). Gelb: Sonne am Spot sichtbar, gestrichelt: verdeckt. Blau: Strassenachse.`)
        : el('p', { class: 'hint' }, 'Kein Horizont berechnet. Unter «Bearbeiten» → «Horizont berechnen» wird die Verschattung durch Gebäude genau bestimmt.'),
      v.spot.axisDeg === null ? el('p', { class: 'hint warn' }, 'Keine Strassenachse gesetzt: Entlang/Quer fehlen. Unter «Bearbeiten» ziehen.') : '',
      v.ray ? el('p', { class: 'hint' }, `Gelber Strahl auf der Karte: ${v.ray.caption}`) : '',
      list,
    );
  }
}
