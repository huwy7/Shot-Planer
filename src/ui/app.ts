import { bearing } from '../lib/angles';
import { backupFileName, createBackup, mergeSpots, parseBackup } from '../lib/backup';
import { cleanAxis, createSpot, updateSpot, validateSpotInput, type Spot } from '../lib/spot';
import { deleteSpot, getSetting, listSpots, putSetting, putSpot, putSpots, type Db } from '../db/db';
import { button, el } from './dom';
import { renderSpotList } from './listView';
import { isBaseLayerId, MapView } from './mapView';
import { renderSettings } from './settingsView';
import { SpotSheet, type Draft } from './spotSheet';

type Tab = 'map' | 'list' | 'settings';

/** Map interaction modes. `place` picks a position at the crosshair, `axis` collects two taps. */
type Mode =
  | { kind: 'browse' }
  | { kind: 'place'; draft: Draft | null }
  | { kind: 'edit'; draft: Draft }
  | { kind: 'axis'; draft: Draft; first: [number, number] | null };

const MIN_AXIS_POINT_DISTANCE_DEG = 0.00002; // ~2 m; closer taps give a meaningless bearing

const spotCount = (n: number): string => (n === 1 ? '1 Spot' : `${n} Spots`);

export async function startApp(root: HTMLElement, db: Db): Promise<void> {
  let spots: Spot[] = await listSpots(db);
  let mode: Mode = { kind: 'browse' };
  let tab: Tab = 'map';

  const savedLayer = await getSetting(db, 'baseLayer');

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
    onCancel: () => setMode({ kind: 'browse' }),
    onDelete: (id) => void remove(id),
    onDrawAxis: (draft) => setMode({ kind: 'axis', draft, first: null }),
    onMove: (draft) => setMode({ kind: 'place', draft }),
  });
  const mapSection = el('section', { class: 'view view-map' }, mapEl, crosshair, banner, toolbar, sheet.root);
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
      if (mode.kind === 'browse') openSpot(id);
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

  function renderMapChrome(): void {
    mapView.setSpots(spots, editingId());
    drawDraft();
    crosshair.hidden = mode.kind !== 'place';
    banner.hidden = mode.kind === 'browse' || mode.kind === 'edit';
    toolbar.replaceChildren();
    switch (mode.kind) {
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
        mapView.reveal(mode.draft.lat, mode.draft.lon, sheet.root.offsetHeight);
        break;
      case 'axis':
        banner.textContent = mode.first ? 'Zweiten Punkt auf der Strasse antippen.' : 'Ersten Punkt auf der Strasse antippen.';
        toolbar.append(button('Abbrechen', () => mode.kind === 'axis' && setMode({ kind: 'edit', draft: mode.draft }), 'btn'));
        sheet.close();
        break;
    }
    if (mode.kind !== 'edit') toolbar.hidden = false;
  }

  function renderList(): void {
    renderSpotList(listSection, spots, (id) => {
      showTab('map');
      openSpot(id);
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
  }

  // --- actions ---
  function openSpot(id: string): void {
    const spot = spots.find((s) => s.id === id);
    if (!spot) return;
    setMode({ kind: 'edit', draft: { ...spot } });
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
    setMode({ kind: 'browse' });
  }

  async function remove(id: string): Promise<void> {
    await deleteSpot(db, id);
    spots = spots.filter((s) => s.id !== id);
    setMode({ kind: 'browse' });
  }

  async function exportSpots(): Promise<string> {
    const now = new Date();
    const json = JSON.stringify(createBackup(spots, now), null, 2);
    const file = new File([json], backupFileName(now), { type: 'application/json' });
    // The iOS share sheet offers "In Dateien sichern"; downloads are unreliable in standalone PWAs.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return `${spotCount(spots.length)} exportiert.`;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'Export abgebrochen.';
      }
    }
    const url = URL.createObjectURL(file);
    const a = el('a', { href: url, download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return `${spotCount(spots.length)} exportiert.`;
  }

  async function importSpots(file: File): Promise<string> {
    const parsed = parseBackup(await file.text());
    const merge = mergeSpots(spots, parsed.spots);
    await putSpots(db, merge.toWrite);
    spots = await listSpots(db);
    renderMapChrome();
    const parts = [`${merge.added} neu`, `${merge.updated} aktualisiert`, `${merge.unchanged} unverändert`];
    if (parsed.rejected > 0) parts.push(`${parsed.rejected} ungültig übersprungen`);
    return `Import: ${parts.join(', ')}.`;
  }

  renderSettings(settingsSection, { onExport: exportSpots, onImport: importSpots });
  showTab('map');
  renderMapChrome();
}
