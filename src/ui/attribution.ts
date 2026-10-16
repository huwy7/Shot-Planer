// Mandatory data source attributions (SPEC N6). Keep visible in the app.
const SOURCES = [
  { label: 'Wetter: Open-Meteo (CC BY 4.0)', href: 'https://open-meteo.com/' },
  { label: 'Karte: © swisstopo', href: 'https://www.swisstopo.admin.ch/' },
  { label: '© OpenStreetMap-Mitwirkende', href: 'https://www.openstreetmap.org/copyright' },
];

export function renderAttribution(target: HTMLElement): void {
  const list = document.createElement('ul');
  list.className = 'attribution';
  for (const source of SOURCES) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = source.href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = source.label;
    item.append(link);
    list.append(item);
  }
  target.append(list);
}
