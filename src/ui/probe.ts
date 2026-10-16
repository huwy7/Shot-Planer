// 3D-data probe (SPEC §11, stage 1): can this browser read swissSURFACE3D tiles directly?

import { dsmItemsUrl, parseStacAssets, pickDsmAsset } from '../lib/stac';
import { parseTiffHeader, TiffError } from '../lib/tiff';

const TIMEOUT_MS = 20000;
const HEADER_BYTES = 64 * 1024;

export interface ProbeResult {
  ok: boolean;
  lines: string[];
}

/** Reads at most `limit` bytes, then cancels, so a server ignoring Range never downloads a whole tile. */
async function readAtMost(res: Response, limit: number): Promise<ArrayBuffer> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.arrayBuffer()).slice(0, limit);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(total, limit));
  let o = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.byteLength, out.byteLength - o));
    out.set(part, o);
    o += part.byteLength;
    if (o >= out.byteLength) break;
  }
  return out.buffer;
}

const networkHint = (err: unknown) =>
  err instanceof DOMException && err.name === 'TimeoutError'
    ? 'Zeitüberschreitung.'
    : 'Blockiert oder nicht erreichbar (oft fehlende CORS-Freigabe).';

export async function runProbe(lat: number, lon: number): Promise<ProbeResult> {
  const lines = [`Punkt ${lat.toFixed(5)}, ${lon.toFixed(5)}`];

  // 1. Catalogue
  let json: unknown;
  try {
    const res = await fetch(dsmItemsUrl(lat, lon), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    lines.push(`1. Katalog: HTTP ${res.status}`);
    if (!res.ok) return { ok: false, lines };
    json = await res.json();
  } catch (err) {
    lines.push(`1. Katalog: ${networkHint(err)}`);
    return { ok: false, lines };
  }

  const assets = parseStacAssets(json);
  const pick = pickDsmAsset(assets);
  lines.push(`2. Kacheln: ${assets.length} GeoTIFF-Dateien gefunden`);
  if (!pick) return { ok: false, lines };
  lines.push(`   gewählt: ${pick.itemId}, ${pick.gsd ?? '?'} m, ${pick.datetime?.slice(0, 4) ?? '?'}`);
  lines.push(`   Typ: ${pick.type ?? 'unbekannt'}`);

  // 2. Range request for the header
  let buf: ArrayBuffer;
  let status: number;
  try {
    const res = await fetch(pick.href, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = res.status;
    buf = await readAtMost(res, HEADER_BYTES);
  } catch (err) {
    lines.push(`3. Datei: ${networkHint(err)}`);
    return { ok: false, lines };
  }
  const ranged = status === 206;
  lines.push(`3. Teilabruf: HTTP ${status} ${ranged ? '(funktioniert)' : '(nicht unterstützt)'}, ${Math.round(buf.byteLength / 1024)} KB gelesen`);

  // 3. Header
  try {
    const t = parseTiffHeader(buf);
    const tiled = t.tileWidth !== null;
    lines.push(`4. ${t.bigTiff ? 'BigTIFF' : 'TIFF'} ${t.width}×${t.height} px, ${t.bitsPerSample ?? '?'} bit, Kompression ${t.compression ?? '?'}`);
    lines.push(`   Kacheln intern: ${tiled ? `${t.tileWidth}×${t.tileHeight}` : 'nein'}, Kopf am Dateianfang: ${t.ifdNearStart ? 'ja' : 'nein'}`);
    lines.push(`   Pixel: ${t.pixelScale ? `${t.pixelScale[0]} m` : '?'}, EPSG ${t.epsg ?? '?'}, Ursprung ${t.origin ? t.origin.map(Math.round).join(' / ') : '?'}`);
    const ok = ranged && tiled && t.ifdNearStart;
    lines.push(ok ? '✅ Machbar: Ausschnitte können direkt im Browser gelesen werden.' : '⚠️ Nur eingeschränkt machbar (siehe oben).');
    return { ok, lines };
  } catch (err) {
    lines.push(`4. Kopf: ${err instanceof TiffError ? err.message : 'nicht lesbar.'}`);
    return { ok: false, lines };
  }
}
