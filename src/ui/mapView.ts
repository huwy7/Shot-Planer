import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { destination } from '../lib/angles';
import type { Spot } from '../lib/spot';

export const START_VIEW = { lat: 46.948, lon: 7.447, zoom: 14 } as const;
const AXIS_HALF_LENGTH_M = 40;
const SUN_RAY_LENGTH_M = 120;

export type BaseLayerId = 'swisstopo-grau' | 'swisstopo-farbe' | 'osm';

const SWISSTOPO_ATTRIBUTION = '<a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener">© swisstopo</a>';
const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap-Mitwirkende</a>';

const swisstopo = (layer: string) =>
  L.tileLayer(`https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.jpeg`, {
    attribution: SWISSTOPO_ATTRIBUTION,
    maxNativeZoom: 18,
    maxZoom: 20,
  });

const BASE_LAYERS: Record<BaseLayerId, { label: string; create: () => L.TileLayer }> = {
  'swisstopo-grau': { label: 'swisstopo grau', create: () => swisstopo('ch.swisstopo.pixelkarte-grau') },
  'swisstopo-farbe': { label: 'swisstopo farbig', create: () => swisstopo('ch.swisstopo.pixelkarte-farbe') },
  osm: {
    label: 'OpenStreetMap',
    create: () =>
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: OSM_ATTRIBUTION,
        maxNativeZoom: 19,
        maxZoom: 20,
      }),
  },
};

export function isBaseLayerId(value: unknown): value is BaseLayerId {
  return typeof value === 'string' && value in BASE_LAYERS;
}

function axisLine(lat: number, lon: number, axisDeg: number): L.LatLngExpression[] {
  return [destination(lat, lon, axisDeg, AXIS_HALF_LENGTH_M), destination(lat, lon, axisDeg + 180, AXIS_HALF_LENGTH_M)];
}

export interface MapViewOptions {
  baseLayer: BaseLayerId;
  onBaseLayerChange: (id: BaseLayerId) => void;
  onSpotClick: (id: string) => void;
  onMapClick: (lat: number, lon: number) => void;
}

/** Thin wrapper around Leaflet; holds no app state besides what is drawn. */
export class MapView {
  readonly map: L.Map;
  private readonly spotsLayer = L.layerGroup();
  private readonly draftLayer = L.layerGroup();
  private readonly locationLayer = L.layerGroup();
  private readonly rayLayer = L.layerGroup();

  constructor(container: HTMLElement, options: MapViewOptions) {
    this.map = L.map(container, { zoomControl: false }).setView([START_VIEW.lat, START_VIEW.lon], START_VIEW.zoom);
    this.map.attributionControl.setPrefix(false);

    const layers = new Map<string, BaseLayerId>();
    const control: Record<string, L.TileLayer> = {};
    for (const [id, def] of Object.entries(BASE_LAYERS) as [BaseLayerId, (typeof BASE_LAYERS)[BaseLayerId]][]) {
      const layer = def.create();
      control[def.label] = layer;
      layers.set(def.label, id);
      if (id === options.baseLayer) layer.addTo(this.map);
    }
    L.control.layers(control, undefined, { position: 'topright' }).addTo(this.map);
    this.map.on('baselayerchange', (e: L.LayersControlEvent) => {
      const id = layers.get(e.name);
      if (id) options.onBaseLayerChange(id);
    });

    this.spotsLayer.addTo(this.map);
    this.locationLayer.addTo(this.map);
    this.rayLayer.addTo(this.map);
    this.draftLayer.addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => options.onMapClick(e.latlng.lat, e.latlng.lng));
    this.onSpotClick = options.onSpotClick;
  }

  private readonly onSpotClick: (id: string) => void;

  setSpots(spots: readonly Spot[], hiddenId: string | null): void {
    this.spotsLayer.clearLayers();
    for (const spot of spots) {
      if (spot.id === hiddenId) continue;
      if (spot.axisDeg !== null) {
        L.polyline(axisLine(spot.lat, spot.lon, spot.axisDeg), { className: 'axis-line', interactive: false }).addTo(
          this.spotsLayer,
        );
      }
      L.circleMarker([spot.lat, spot.lon], { radius: 9, className: 'spot-marker' })
        .bindTooltip(spot.name, { direction: 'top', offset: [0, -8] })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          this.onSpotClick(spot.id);
        })
        .addTo(this.spotsLayer);
    }
  }

  /** Draws the spot being edited, with its axis and an optional first axis point. */
  showDraft(lat: number, lon: number, axisDeg: number | null, axisStart?: [number, number]): void {
    this.draftLayer.clearLayers();
    if (axisDeg !== null) {
      L.polyline(axisLine(lat, lon, axisDeg), { className: 'axis-line draft', interactive: false }).addTo(this.draftLayer);
    }
    L.circleMarker([lat, lon], { radius: 10, className: 'spot-marker draft', interactive: false }).addTo(this.draftLayer);
    if (axisStart) {
      L.circleMarker(axisStart, { radius: 7, className: 'axis-point', interactive: false }).addTo(this.draftLayer);
    }
  }

  clearDraft(): void {
    this.draftLayer.clearLayers();
  }

  /** Draws a ray from the spot towards the sun (the direction light comes from). */
  showSunRay(lat: number, lon: number, azimuthDeg: number): void {
    this.rayLayer.clearLayers();
    const end = destination(lat, lon, azimuthDeg, SUN_RAY_LENGTH_M);
    L.polyline([[lat, lon], end], { className: 'sun-ray', interactive: false }).addTo(this.rayLayer);
    L.circleMarker(end, { radius: 8, className: 'sun-dot', interactive: false }).addTo(this.rayLayer);
  }

  clearSunRay(): void {
    this.rayLayer.clearLayers();
  }

  center(): { lat: number; lon: number } {
    const c = this.map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  focus(lat: number, lon: number, minZoom = 17): void {
    this.map.setView([lat, lon], Math.max(this.map.getZoom(), minZoom));
  }

  /** Centers a point in the map area left uncovered by an overlay of `coveredBottomPx` at the bottom. */
  reveal(lat: number, lon: number, coveredBottomPx: number): void {
    const zoom = Math.max(this.map.getZoom(), 17);
    const point = this.map.project([lat, lon], zoom).add([0, coveredBottomPx / 2]);
    this.map.setView(this.map.unproject(point, zoom), zoom, { animate: false });
  }

  showLocation(lat: number, lon: number, accuracyM: number): void {
    this.locationLayer.clearLayers();
    L.circle([lat, lon], { radius: accuracyM, className: 'location-accuracy', interactive: false }).addTo(this.locationLayer);
    L.circleMarker([lat, lon], { radius: 6, className: 'location-dot', interactive: false }).addTo(this.locationLayer);
  }

  /** Leaflet needs this after its container was hidden. */
  refreshSize(): void {
    this.map.invalidateSize();
  }
}
