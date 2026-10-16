import { renderAttribution } from './attribution';
import { button, el } from './dom';

export interface SettingsHandlers {
  onExport: () => Promise<string>;
  onImport: (file: File) => Promise<string>;
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

  const sources = el('div');
  renderAttribution(sources);

  target.replaceChildren(
    el('h1', {}, 'Einstellungen'),
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
