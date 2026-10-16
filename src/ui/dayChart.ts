import type { DayLight } from '../lib/light';
import { classifyClouds, type HourWeather } from '../lib/weather';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 300;
const H = 100;
const LABEL_H = 14;
const ALT_MIN = -20;
const ALT_MAX = 70;
const STRIP_H = 8;
const WEATHER_GAP = 3;
const WEATHER_H = 10;
const HOUR_MS = 3600 * 1000;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * Sun altitude over the day with blue/golden hour bands, an axis-window strip at the bottom (SPEC F4–F6)
 * and an hourly cloud-class strip below (F7).
 */
export function renderDayChart(day: DayLight, now: Date, weather: readonly HourWeather[] = []): SVGSVGElement {
  const t0 = day.dayStart.getTime();
  const span = day.dayEnd.getTime() - t0;
  const x = (t: Date) => (((t.getTime() - t0) / span) * W).toFixed(1);
  const y = (alt: number) => (H - ((Math.min(ALT_MAX, Math.max(ALT_MIN, alt)) - ALT_MIN) / (ALT_MAX - ALT_MIN)) * H).toFixed(1);

  const weatherTop = H + WEATHER_GAP;
  const labelTop = weatherTop + WEATHER_H;
  const root = svg('svg', { viewBox: `0 0 ${W} ${labelTop + LABEL_H}`, class: 'day-chart', role: 'img' });
  root.setAttribute('aria-label', 'Sonnenhöhe im Tagesverlauf');

  for (const w of day.windows) {
    const x0 = Number(x(w.start));
    const width = Math.max(1, Number(x(w.end)) - x0);
    const axisStrip = w.kind === 'along' || w.kind === 'across';
    root.append(
      svg('rect', {
        x: x0,
        y: axisStrip ? H - STRIP_H : 0,
        width,
        height: axisStrip ? STRIP_H : H - STRIP_H,
        class: `band band-${w.kind}`,
      }),
    );
  }

  root.append(svg('line', { x1: 0, x2: W, y1: y(0), y2: y(0), class: 'horizon' }));
  for (let h = 0; h <= 24; h += 6) {
    const xh = ((h / 24) * W).toFixed(1);
    root.append(svg('line', { x1: xh, x2: xh, y1: 0, y2: H, class: 'grid' }));
    const label = svg('text', { x: xh, y: labelTop + LABEL_H - 2, class: 'tick', 'text-anchor': h === 0 ? 'start' : h === 24 ? 'end' : 'middle' });
    label.textContent = `${h}`;
    root.append(label);
  }

  for (const h of weather) {
    const cls = classifyClouds(h);
    if (!cls) continue;
    const start = new Date(Math.max(h.time, t0));
    const end = new Date(Math.min(h.time + HOUR_MS, t0 + span));
    if (end <= start) continue;
    const x0 = Number(x(start));
    root.append(svg('rect', { x: x0, y: weatherTop, width: Math.max(0.5, Number(x(end)) - x0 - 0.5), height: WEATHER_H, class: `cloud cloud-${cls}` }));
  }

  const points = day.samples.map((s) => `${x(s.time)},${y(s.pos.altitudeDeg)}`).join(' ');
  root.append(svg('polyline', { points, class: 'sun-curve' }));

  if (now >= day.dayStart && now < day.dayEnd) {
    root.append(svg('line', { x1: x(now), x2: x(now), y1: 0, y2: H, class: 'now' }));
  }
  return root;
}
