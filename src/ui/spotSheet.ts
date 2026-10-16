import { cleanAxis, clampMinSunAlt, MIN_SUN_ALT_RANGE, NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from '../lib/spot';
import { button, el, formatDeg } from './dom';

export interface Draft {
  /** Id of the spot being edited, or null for a new spot. */
  id: string | null;
  name: string;
  note: string;
  lat: number;
  lon: number;
  axisDeg: number | null;
  minSunAltDeg: number;
}

export interface SpotSheetHandlers {
  onChange: (draft: Draft) => void;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onDrawAxis: (draft: Draft) => void;
  onMove: (draft: Draft) => void;
}

/** Bottom sheet for creating and editing a spot. */
export class SpotSheet {
  readonly root: HTMLElement;
  private draft: Draft | null = null;
  private readonly title = el('h2');
  private readonly name = el('input', { type: 'text', maxlength: String(NAME_MAX_LENGTH), autocomplete: 'off', enterkeyhint: 'done' });
  private readonly note = el('textarea', { rows: '2', maxlength: String(NOTE_MAX_LENGTH) });
  private readonly axis = el('input', { type: 'number', inputmode: 'decimal', min: '0', max: '179.9', step: '0.1', placeholder: '–' });
  private readonly axisHint = el('p', { class: 'hint' });
  private readonly minAlt = el('input', {
    type: 'number',
    inputmode: 'numeric',
    min: String(MIN_SUN_ALT_RANGE.min),
    max: String(MIN_SUN_ALT_RANGE.max),
    step: '1',
  });
  private readonly error = el('p', { class: 'error', role: 'alert' });
  private readonly deleteBtn: HTMLButtonElement;

  constructor(private readonly handlers: SpotSheetHandlers) {
    this.name.addEventListener('input', () => this.update({ name: this.name.value }));
    this.note.addEventListener('input', () => this.update({ note: this.note.value }));
    this.axis.addEventListener('change', () => {
      const raw = this.axis.value.trim().replace(',', '.');
      this.update({ axisDeg: raw === '' ? null : cleanAxis(Number(raw)) });
      this.render();
    });
    this.minAlt.addEventListener('change', () => {
      this.update({ minSunAltDeg: clampMinSunAlt(Number(this.minAlt.value)) });
      this.render();
    });

    const step = (delta: number) => () => {
      if (!this.draft || this.draft.axisDeg === null) return;
      this.update({ axisDeg: cleanAxis(this.draft.axisDeg + delta) });
      this.render();
    };

    this.deleteBtn = button('Löschen', () => this.confirmDelete(), 'btn danger');

    this.root = el(
      'section',
      { class: 'sheet', hidden: true, 'aria-label': 'Spot bearbeiten' },
      this.title,
      el('label', { class: 'field' }, el('span', {}, 'Name'), this.name),
      el('label', { class: 'field' }, el('span', {}, 'Notiz'), this.note),
      el(
        'div',
        { class: 'field' },
        el('span', {}, 'Strassenachse (0–180°)'),
        el(
          'div',
          { class: 'row' },
          button('−1°', step(-1), 'btn square'),
          this.axis,
          button('+1°', step(1), 'btn square'),
          button('Auf Karte ziehen', () => this.draft && handlers.onDrawAxis({ ...this.draft }), 'btn'),
        ),
        this.axisHint,
      ),
      el(
        'label',
        { class: 'field' },
        el('span', {}, 'Sonne sichtbar ab Höhe (°)'),
        this.minAlt,
        el('p', { class: 'hint' }, 'Darunter verdecken Gebäude die Sonne. 0 = freie Sicht.'),
      ),
      el('div', { class: 'row' }, button('Position neu setzen', () => this.draft && handlers.onMove({ ...this.draft }), 'btn')),
      this.error,
      el(
        'div',
        { class: 'row actions' },
        this.deleteBtn,
        el('span', { class: 'spacer' }),
        button('Abbrechen', () => handlers.onCancel(), 'btn'),
        button('Speichern', () => this.draft && handlers.onSave({ ...this.draft }), 'btn primary'),
      ),
    );
  }

  open(draft: Draft): void {
    this.draft = { ...draft };
    this.error.textContent = '';
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.draft = null;
    this.root.hidden = true;
  }

  showError(message: string): void {
    this.error.textContent = message;
  }

  private update(patch: Partial<Draft>): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, ...patch };
    this.error.textContent = '';
    this.handlers.onChange({ ...this.draft });
  }

  private render(): void {
    const d = this.draft;
    if (!d) return;
    this.title.textContent = d.id ? 'Spot bearbeiten' : 'Neuer Spot';
    this.name.value = d.name;
    this.note.value = d.note;
    this.axis.value = d.axisDeg === null ? '' : String(d.axisDeg);
    this.axisHint.textContent =
      d.axisDeg === null
        ? 'Ohne Achse gibt es keine Licht-entlang-der-Gasse-Fenster.'
        : `Achse ${formatDeg(d.axisDeg)} / ${formatDeg(d.axisDeg + 180)}`;
    this.minAlt.value = String(d.minSunAltDeg);
    this.deleteBtn.hidden = d.id === null;
  }

  private confirmDelete(): void {
    if (!this.draft?.id) return;
    if (window.confirm(`Spot «${this.draft.name}» löschen?`)) this.handlers.onDelete(this.draft.id);
  }
}
