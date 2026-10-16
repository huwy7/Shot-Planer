import { bearing } from '../lib/angles';
import { backupFileName, createBackup, mergeHits, mergeSpots, parseBackup } from '../lib/backup';
import { createHit, type HitRating } from '../lib/hits';
import { clampLightSettings, type LightSettings } from '../lib/light';
import { nextGood, planSpot, topWindows, type SpotPlan } from '../lib/score';
import { cleanAxis, createSpot, updateSpot, validateSpotInput, type Spot } from '../lib/spot';
import { sunAt } from '../lib/sun';
import { hoursBetween, locationKey, weatherAt, type HourWeather } from '../lib/weather';
import { deleteSpot, getSetting, listHits, listSpots, putHits, putSetting, putSpot, putSpots, type Db } from '../db/db';
import { DAYS_AHEAD, DetailSheet, describeSun, type DetailView } from './detailSheet';
import { button, el } from './dom';
import { renderSpotList, type ListSort } from './listView';
import { isBaseLayerId, MapView } from './mapView';
import { renderSettings } from './settingsView';
import { SpotSheet, type Draft } from './spotSheet';
import { WeatherStore } from './weatherStore';

type Tab = 'map' | 'list' | 'settings';

/** Map interaction modes. `place` picks a position at the crosshair, `axis` collects two taps. */
type Mode =
  | { kind: 'browse' }
  | { kind: 'detail'; spotId: string; dayIndex: number; selected: number | null }
  | { kind: 'place'; draft: Draft | null }
  | { kind: 'edit'; draft: Draft }
  | { kind: 'axis'; draft: Draft; first: [number, number] | null };

const MIN_AXIS_POINT_DISTANCE_DEG = 0.00002; // ~2 m; closer taps give a meaningless bearing

const spotCount = (n: number): string => (n === 1 ? '1 Spot' : `${n} Spots`);
const dateTime = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function startApp(root: HTMLElement, db: Db): Promise<void> {
  let spots: Spot[] = await listSpots(db);
  let mode: Mode = { kind: 'browse' };
  let tab: Tab = 'map';

  const savedLayer = await getSetting(db, 'baseLayer');
  let lightSettings: LightSettings = clampLightSettings(await getSetting<Partial<LightSettings>>(db, 'light'));
  /** Spot the map was last centered on for a sheet, so re-renders do not fight the user's panning. */
  let revealedFor: string | null = null;
  let hitCount = (await listHits(db)).length;
  let hitStatus = '';
  let listSort: ListSort = (await getSetting<ListSort>(db, 'listSort')) === 'name' ? 'name' : 'next';

  const weather = new WeatherStore(db, () => {
    if (mode.kind === 'detail') renderMapChrome();
    if (tab === 'settings') renderSettingsView();
    if (tab === 'list') renderList();
  });
  await weather.load();

  function weatherStatus(): string {
    const { forecast, loading, error } = weather.state;
    if (loading) return 'Wetter wird geladen …';
    const stand = forecast ? `Stand ${dateTime.format(new Date(forecast.fetchedAt))}` : 'noch keine Prognose';
    return error ? `${error} (${stand})` : `Wetter: Open-Meteo, ${stand}`;
  }

  // --- layout ---
  const mapEl = el('div', { class: 'map' });
  const banner = el('div', { class: 'banner', hidden: true });
  const crosshair = el('div', { class: 'crosshair', hidden: true, 'aria-hidden': 'true' });
  const toolbar = el('div', { class: 'toolbar' });
  const sheet = new SpotSheet({
    onChange: (draft) => {
      if (mode.kind === 'edit') mode = { kind: 'edit', draft };
      drawDraft();
    },
    onSave: (draft) => void save(draft),
    onCancel: () => (mode.kind === 'edit' && mode.draft.id ? openDetail(mode.draft.id) : setMode({ kind: 'browse' })),
    onDelete: (id) => void remove(id),
    onDrawAxis: (draft) => setMode({ kind: 'axis', draft, first: null }),
    onMove: (draft) => setMode({ kind: 'place', draft }),
  });
  const detail = new DetailSheet({
    onDay: (dayIndex) => mode.kind === 'detail' && setMode({ ...mode, dayIndex, selected: null }),
    onSelect: (selected) => mode.kind === 'detail' && setMode({ ...mode, selected }),
    onJump: (dayIndex, selected) => mode.kind === 'detail' && setMode({ ...mode, dayIndex, selected }),
    onHit: (rating) => void recordHit(rating),
    onEdit: () => {
      if (mode.kind !== 'detail') return;
      const id = mode.spotId;
      const spot = spots.find((s) => s.id === id);
      if (spot) setMode({ kind: 'edit', draft: { ...spot } });
    },
    onClose: () => setMode({ kind: 'browse' }),
  });

  function forecastHours(spot: Spot): HourWeather[] | undefined {
    return weather.state.forecast?.locations[locationKey(spot.lat, spot.lon)];
  }

  function planFor(spot: Spot, now: Date): SpotPlan {
    return planSpot(sunAt(spot.lat, spot.lon), spot, lightSettings, forecastHours(spot), now, DAYS_AHEAD);
  }
  const mapSection = el('section', { class: 'view view-map' }, mapEl, crosshair, banner, toolbar, sheet.root, detail.root);
  const listSection = el('section', { class: 'view view-scroll', hidden: true });
  const settingsSection = el('section', { class: 'view view-scroll', hidden: true });

  const tabButtons = new Map<Tab, HTMLButtonElement>();
  const tabbar = el('nav', { class: 'tabbar' });
  for (const [id, label] of [
    ['map', 'Karte'],
    ['list', 'Liste'],
    ['settings', 'Einstellungen'],
  ] as const) {
    const b = button(label, () => showTab(id), 'tab');
    tabButtons.set(id, b);
    tabbar.append(b);
  }
  root.replaceChildren(mapSection, listSection, settingsSection, tabbar);

  const mapView = new MapView(mapEl, {
    baseLayer: isBaseLayerId(savedLayer) ? savedLayer : 'swisstopo-grau',
    onBaseLayerChange: (id) => void putSetting(db, 'baseLayer', id),
    onSpotClick: (id) => {
      if (mode.kind === 'browse' || mode.kind === 'detail') openDetail(id);
    },
    onMapClick: (lat, lon) => {
      if (mode.kind === 'axis') handleAxisTap(lat, lon);
    },
  });

  // --- rendering ---
  function editingId(): string | null {
    return mode.kind === 'edit' || mode.kind === 'axis' ? mode.draft.id : mode.kind === 'place' ? (mode.draft?.id ?? null) : null;
  }

  function drawDraft(): void {
    if (mode.kind === 'edit') mapView.showDraft(mode.draft.lat, mode.draft.lon, mode.draft.axisDeg);
    else if (mode.kind === 'axis') mapView.showDraft(mode.draft.lat, mode.draft.lon, null, mode.first ?? undefined);
    else mapView.clearDraft();
  }

  function revealOnce(key: string, lat: number, lon: number, sheetEl: HTMLElement): void {
    if (revealedFor === key) return;
    revealedFor = key;
    mapView.reveal(lat, lon, sheetEl.offsetHeight);
  }

  function detailView(m: Extract<Mode, { kind: 'detail' }>, spot: Spot): DetailView {
    const now = new Date();
    const sun = sunAt(spot.lat, spot.lon);
    const plan = planFor(spot, now);
    const scoredDay = plan.days[m.dayIndex];
    const day = scoredDay.day;
    const selected = m.selected !== null && m.selected < day.windows.length ? m.selected : null;
    let ray: DetailView['ray'] = null;
    if (selected !== null) {
      const w = day.windows[selected];
      ray = { pos: w.mid, caption: `Fenstermitte, ${describeSun(w.mid)}` };
    } else if (m.dayIndex === 0) {
      const pos = sun(now);
      if (pos.altitudeDeg > 0) ray = { pos, caption: `Sonne jetzt, ${describeSun(pos)}` };
    }
    const hours = hoursBetween(forecastHours(spot), day.dayStart, day.dayEnd);
    const status =
      hours.length === 0 && !weather.state.loading ? `Keine Wetterprognose für diesen Tag. ${weatherStatus()}` : weatherStatus();
    return {
      spot,
      dayIndex: m.dayIndex,
      scoredDay,
      top: topWindows(plan, now),
      now,
      selected,
      ray,
      weather: { hours, status },
      hitStatus,
    };
  }

  function renderMapChrome(): void {
    mapView.setSpots(spots, editingId());
    drawDraft();
    crosshair.hidden = mode.kind !== 'place';
    banner.hidden = mode.kind === 'browse' || mode.kind === 'edit' || mode.kind === 'detail';
    toolbar.replaceChildren();
    if (mode.kind !== 'detail') {
      detail.close();
      mapView.clearSunRay();
    }
    if (mode.kind !== 'detail' && mode.kind !== 'edit') revealedFor = null;
    switch (mode.kind) {
      case 'detail': {
        const id = mode.spotId;
        const spot = spots.find((s) => s.id === id);
        if (!spot) {
          setMode({ kind: 'browse' });
          return;
        }
        const view = detailView(mode, spot);
        toolbar.hidden = true;
        sheet.close();
        detail.open(view);
        if (view.ray) mapView.showSunRay(spot.lat, spot.lon, view.ray.pos.azimuthDeg);
        else mapView.clearSunRay();
        revealOnce(`detail:${spot.id}`, spot.lat, spot.lon, detail.root);
        break;
      }
      case 'browse':
        toolbar.append(button('Standort', locate, 'btn'), el('span', { class: 'spacer' }), button('+ Spot', () => setMode({ kind: 'place', draft: null }), 'btn primary'));
        sheet.close();
        break;
      case 'place':
        banner.textContent = 'Karte verschieben, bis das Kreuz auf dem Spot liegt.';
        toolbar.append(
          button('Abbrechen', cancelPlace, 'btn'),
          button('Standort', locate, 'btn'),
          el('span', { class: 'spacer' }),
          button('Hier setzen', confirmPlace, 'btn primary'),
        );
        sheet.close();
        break;
      case 'edit':
        toolbar.hidden = true;
        sheet.open(mode.draft);
        revealOnce(`edit:${mode.draft.id ?? 'new'}:${mode.draft.lat},${mode.draft.lon}`, mode.draft.lat, mode.draft.lon, sheet.root);
        break;
      case 'axis':
        banner.textContent = mode.first ? 'Zweiten Punkt auf der Strasse antippen.' : 'Ersten Punkt auf der Strasse antippen.';
        toolbar.append(button('Abbrechen', () => mode.kind === 'axis' && setMode({ kind: 'edit', draft: mode.draft }), 'btn'));
        sheet.close();
        break;
    }
    if (mode.kind !== 'edit' && mode.kind !== 'detail') toolbar.hidden = false;
  }

  function renderList(): void {
    const now = new Date();
    const entries = spots.map((spot) => ({ spot, next: nextGood(planFor(spot, now), now) }));
    renderSpotList(listSection, entries, listSort, now, {
      onSelect: (id) => {
        showTab('map');
        openDetail(id);
      },
      onSort: (sort) => {
        listSort = sort;
        void putSetting(db, 'listSort', sort);
        renderList();
      },
    });
  }

  function setMode(next: Mode): void {
    mode = next;
    renderMapChrome();
  }

  function showTab(next: Tab): void {
    tab = next;
    mapSection.hidden = tab !== 'map';
    listSection.hidden = tab !== 'list';
    settingsSection.hidden = tab !== 'settings';
    for (const [id, b] of tabButtons) b.setAttribute('aria-current', String(id === tab));
    if (tab === 'map') mapView.refreshSize();
    if (tab === 'list') renderList();
    if (tab === 'settings') renderSettingsView();
  }

  // --- actions ---
  function openDetail(id: string): void {
    if (!spots.some((s) => s.id === id)) return;
    hitStatus = '';
    setMode({ kind: 'detail', spotId: id, dayIndex: 0, selected: null });
    void weather.refresh(spots);
  }

  function confirmPlace(): void {
    if (mode.kind !== 'place') return;
    const { lat, lon } = mapView.center();
    const draft: Draft = mode.draft
      ? { ...mode.draft, lat, lon }
      : { id: null, name: '', note: '', lat, lon, axisDeg: null, minSunAltDeg: 0 };
    setMode({ kind: 'edit', draft });
  }

  function cancelPlace(): void {
    if (mode.kind !== 'place') return;
    setMode(mode.draft ? { kind: 'edit', draft: mode.draft } : { kind: 'browse' });
  }

  function handleAxisTap(lat: number, lon: number): void {
    if (mode.kind !== 'axis') return;
    if (!mode.first) {
      setMode({ ...mode, first: [lat, lon] });
      return;
    }
    const [lat1, lon1] = mode.first;
    if (Math.abs(lat - lat1) < MIN_AXIS_POINT_DISTANCE_DEG && Math.abs(lon - lon1) < MIN_AXIS_POINT_DISTANCE_DEG) return;
    setMode({ kind: 'edit', draft: { ...mode.draft, axisDeg: cleanAxis(bearing(lat1, lon1, lat, lon)) } });
  }

  function locate(): void {
    if (!navigator.geolocation) {
      window.alert('Standort ist auf diesem Gerät nicht verfügbar.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapView.showLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        mapView.focus(pos.coords.latitude, pos.coords.longitude, 18);
      },
      (err) =>
        window.alert(
          err.code === err.PERMISSION_DENIED
            ? 'Standortzugriff verweigert. In den iOS-Einstellungen für Safari erlauben.'
            : 'Standort konnte nicht bestimmt werden.',
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  async function save(draft: Draft): Promise<void> {
    const error = validateSpotInput(draft);
    if (error) {
      sheet.showError(error);
      return;
    }
    const now = new Date();
    const existing = draft.id ? spots.find((s) => s.id === draft.id) : undefined;
    const spot = existing ? updateSpot(existing, draft, now) : createSpot(draft, now);
    await putSpot(db, spot);
    spots = [...spots.filter((s) => s.id !== spot.id), spot];
    openDetail(spot.id);
  }

  async function recordHit(rating: HitRating): Promise<void> {
    if (mode.kind !== 'detail') return;
    const id = mode.spotId;
    const spot = spots.find((s) => s.id === id);
    if (!spot) return;
    const now = new Date();
    const active = upcomingNow(planFor(spot, now), now);
    const hit = createHit(spot.id, rating, now, {
      sun: sunAt(spot.lat, spot.lon)(now),
      weather: weatherAt(forecastHours(spot), now),
      activeWindows: active.map((s) => ({ kind: s.window.kind, score: s.score })),
      score: active.length > 0 ? Math.max(...active.map((s) => s.score)) : null,
      settings: lightSettings,
    });
    await putHits(db, [hit]);
    hitCount++;
    const scoreText = hit.inputs.score === null ? 'ausserhalb aller Fenster' : `Score jetzt ${hit.inputs.score}`;
    hitStatus = `Treffer «${rating === 'good' ? 'gut' : 'schlecht'}» gespeichert (${scoreText}).`;
    renderMapChrome();
  }

  /** Windows of today that contain `now`. */
  function upcomingNow(plan: SpotPlan, now: Date) {
    const t = now.getTime();
    return plan.days[0].scored.filter((s) => s.window.start.getTime() <= t && s.window.end.getTime() > t);
  }

  async function remove(id: string): Promise<void> {
    await deleteSpot(db, id);
    hitCount = (await listHits(db)).length;
    spots = spots.filter((s) => s.id !== id);
    setMode({ kind: 'browse' });
  }

  async function exportSpots(): Promise<string> {
    const now = new Date();
    const hits = await listHits(db);
    const json = JSON.stringify(createBackup(spots, hits, now), null, 2);
    const file = new File([json], backupFileName(now), { type: 'application/json' });
    // The iOS share sheet offers "In Dateien sichern"; downloads are unreliable in standalone PWAs.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return `${spotCount(spots.length)} und ${hits.length} Treffer exportiert.`;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'Export abgebrochen.';
      }
    }
    const url = URL.createObjectURL(file);
    const a = el('a', { href: url, download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return `${spotCount(spots.length)} und ${hits.length} Treffer exportiert.`;
  }

  async function importSpots(file: File): Promise<string> {
    const parsed = parseBackup(await file.text());
    const merge = mergeSpots(spots, parsed.spots);
    await putSpots(db, merge.toWrite);
    spots = await listSpots(db);
    const existingHits = await listHits(db);
    const hitMerge = mergeHits(new Set(existingHits.map((h) => h.id)), new Set(spots.map((s) => s.id)), parsed.hits);
    await putHits(db, hitMerge.toWrite);
    hitCount = existingHits.length + hitMerge.toWrite.length;
    renderMapChrome();
    const parts = [`${merge.added} neu`, `${merge.updated} aktualisiert`, `${merge.unchanged} unverändert`];
    if (hitMerge.toWrite.length > 0) parts.push(`${hitMerge.toWrite.length} Treffer`);
    if (parsed.rejected + hitMerge.orphaned > 0) parts.push(`${parsed.rejected + hitMerge.orphaned} ungültig übersprungen`);
    return `Import: ${parts.join(', ')}.`;
  }

  async function changeLightSettings(next: LightSettings): Promise<LightSettings> {
    lightSettings = clampLightSettings(next);
    await putSetting(db, 'light', lightSettings);
    renderMapChrome();
    return lightSettings;
  }

  function renderSettingsView(): void {
    renderSettings(settingsSection, {
      onExport: exportSpots,
      onImport: importSpots,
      lightSettings,
      onLightSettings: changeLightSettings,
      weatherStatus: weatherStatus(),
      weatherLoading: weather.state.loading,
      onRefreshWeather: () => void weather.refresh(spots, true),
      spotCount: spots.length,
      hitCount,
    });
  }

  renderSettingsView();
  void weather.refresh(spots);
  showTab('map');
  renderMapChrome();
}
