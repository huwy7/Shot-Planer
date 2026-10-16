import type { HorizonProfile } from '../lib/horizon';
import { sunVisible, type DayLight, type SpotGeometry } from '../lib/light';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 360;
const H = 90;
const LABEL_H = 14;
const ALT_MAX = 60;
const ALT_MIN = -5;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const y = (alt: number) => (H - ((Math.min(ALT_MAX, Math.max(ALT_MIN, alt)) - ALT_MIN) / (ALT_MAX - ALT_MIN)) * H).toFixed(1);

/** Skyline (obstruction per azimuth) with the day's sun path; visible parts solid, hidden parts dashed. */
export function renderHorizonChart(profile: HorizonProfile, day: DayLight, geom: SpotGeometry): SVGSVGElement {
  const root = svg('svg', { viewBox: `0 0 ${W} ${H + LABEL_H}`, class: 'horizon-chart', role: 'img' });
  root.setAttribute('aria-label', 'Horizont und Sonnenbahn');

  const skyline = profile.deg.map((d, az) => `${az},${y(d)}`).join(' ');
  root.append(svg('polygon', { points: `0,${H} ${skyline} ${W},${y(profile.deg[0])} ${W},${H}`, class: 'skyline' }));
  root.append(svg('line', { x1: 0, x2: W, y1: y(0), y2: y(0), class: 'horizon' }));

  if (geom.axisDeg !== null) {
    for (const a of [geom.axisDeg, geom.axisDeg + 180]) {
      root.append(svg('line', { x1: a, x2: a, y1: 0, y2: H, class: 'axis-mark' }));
    }
  }

  // Sun path, split into runs of equal visibility and at the north wrap-around.
  let run: string[] = [];
  let runVisible: boolean | null = null;
  let lastAz: number | null = null;
  const flush = () => {
    if (run.length > 1) root.append(svg('polyline', { points: run.join(' '), class: runVisible ? 'sun-path' : 'sun-path hidden' }));
    run = [];
  };
  for (const s of day.samples) {
    if (s.pos.altitudeDeg < ALT_MIN) {
      flush();
      lastAz = null;
      continue;
    }
    const visible = sunVisible(s.pos, geom);
    const az = s.pos.azimuthDeg;
    if (lastAz !== null && Math.abs(az - lastAz) > 180) flush();
    if (runVisible !== null && visible !== runVisible && run.length > 0) {
      const last = run[run.length - 1];
      flush();
      run.push(last);
    }
    runVisible = visible;
    run.push(`${az.toFixed(1)},${y(s.pos.altitudeDeg)}`);
    lastAz = az;
  }
  flush();

  for (const [az, label] of [
    [0, 'N'],
    [90, 'O'],
    [180, 'S'],
    [270, 'W'],
    [360, 'N'],
  ] as const) {
    root.append(svg('line', { x1: az, x2: az, y1: 0, y2: H, class: 'grid' }));
    const t = svg('text', { x: az, y: H + LABEL_H - 2, class: 'tick', 'text-anchor': az === 0 ? 'start' : az === 360 ? 'end' : 'middle' });
    t.textContent = label;
    root.append(t);
  }
  return root;
}
