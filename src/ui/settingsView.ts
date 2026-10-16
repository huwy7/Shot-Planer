import { LIGHT_SETTINGS_RANGE, type LightSettings } from '../lib/light';
import { renderAttribution } from './attribution';
import { button, el } from './dom';

export interface SettingsHandlers {
  onExport: () => Promise<string>;
  onImport: (file: File) => Promise<string>;
  lightSettings: LightSettings;
  /** Persists and returns the clamped settings. */
  onLightSettings: (s: LightSettings) => Promise<LightSettings>;
}

function numberField(label: string, hint: string, value: number, range: { min: number; max: number }, onChange: (v: number) => void) {
  const input = el('input', { type: 'number', inputmode: 'numeric', min: String(range.min), max: String(range.max), step: '1' });
  input.value = String(value);
  input.addEventListener('change', () => onChange(Number(input.value)));
  return { input, node: el('label', { class: 'field' }, el('span', {}, label), input, el('p', { class: 'hint' }, hint)) };
}

export function renderSettings(target: HTMLElement, handlers: SettingsHandlers): void {
  const status = el('p', { class: 'status', role: 'status' });
  const run = (task: () => Promise<string>) => async () => {
    status.textContent = '…';
    try {
      status.textContent = await task();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Unbekannter Fehler.';
    }
  };

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void run(() => handlers.onImport(file))();
  });

  const storage = el('p', { class: 'muted' }, 'Speicherstatus wird geprüft …');
  if (navigator.storage?.persisted) {
    void navigator.storage.persisted().then((persisted) => {
      storage.textContent = persisted
        ? 'Daten sind als dauerhaft markiert.'
        : 'Daten sind nicht dauerhaft geschützt. Regelmässig exportieren.';
    });
  } else {
    storage.textContent = 'Speicherstatus nicht verfügbar.';
  }

  let light = handlers.lightSettings;
  const save = async (patch: Partial<LightSettings>) => {
    light = await handlers.onLightSettings({ ...light, ...patch });
    tolerance.input.value = String(light.toleranceDeg);
    maxAlt.input.value = String(light.maxAltitudeDeg);
  };
  const tolerance = numberField(
    'Toleranz Achse (±°)',
    `Wie genau die Sonne parallel oder quer zur Strasse stehen muss. Standard 10, ${LIGHT_SETTINGS_RANGE.toleranceDeg.min}–${LIGHT_SETTINGS_RANGE.toleranceDeg.max}.`,
    light.toleranceDeg,
    LIGHT_SETTINGS_RANGE.toleranceDeg,
    (v) => void save({ toleranceDeg: v }),
  );
  const maxAlt = numberField(
    'Maximale Sonnenhöhe für Entlang/Quer (°)',
    `Darüber fällt kaum Licht in die Gasse. Standard 20, ${LIGHT_SETTINGS_RANGE.maxAltitudeDeg.min}–${LIGHT_SETTINGS_RANGE.maxAltitudeDeg.max}.`,
    light.maxAltitudeDeg,
    LIGHT_SETTINGS_RANGE.maxAltitudeDeg,
    (v) => void save({ maxAltitudeDeg: v }),
  );

  const sources = el('div');
  renderAttribution(sources);

  target.replaceChildren(
    el('h1', {}, 'Einstellungen'),
    el('h2', {}, 'Licht'),
    tolerance.node,
    maxAlt.node,
    el('h2', {}, 'Sicherung'),
    el('p', { class: 'muted' }, 'Spots liegen nur auf diesem Gerät. Export schützt vor Datenverlust.'),
    el(
      'div',
      { class: 'row' },
      button('Spots exportieren', run(handlers.onExport), 'btn primary'),
      button('Importieren', () => fileInput.click(), 'btn'),
    ),
    fileInput,
    status,
    el('h2', {}, 'Speicher'),
    storage,
    el('h2', {}, 'Quellen'),
    sources,
    el('p', { class: 'muted small' }, `Version ${__APP_VERSION__}`),
  );
}
