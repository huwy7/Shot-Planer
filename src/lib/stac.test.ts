import { describe, expect, it } from 'vitest';
import { dsmItemsUrl, parseStacAssets, pickDsmAsset } from './stac';

const asset = (href: string, extra: Record<string, unknown> = {}) => ({ href, type: 'image/tiff; application=geotiff; profile=cloud-optimized', ...extra });

const response = {
  type: 'FeatureCollection',
  features: [
    {
      id: 'swisssurface3d-raster_2019_2600-1199',
      properties: { datetime: '2019-01-01T00:00:00Z' },
      assets: {
        'swisssurface3d-raster_2019_2600-1199_0.5_2056_5728.tif': asset(
          'https://data.geo.admin.ch/ch.swisstopo.swisssurface3d-raster/swisssurface3d-raster_2019_2600-1199/swisssurface3d-raster_2019_2600-1199_0.5_2056_5728.tif',
        ),
        'swisssurface3d-raster_2019_2600-1199_2_2056_5728.tif': asset('https://data.geo.admin.ch/x/y_2_2056_5728.tif'),
      },
    },
    {
      id: 'swisssurface3d-raster_2023_2600-1199',
      properties: { datetime: '2023-01-01T00:00:00Z' },
      assets: {
        a: asset('https://data.geo.admin.ch/x/new_0.5_2056_5728.tif', { gsd: 0.5 }),
        evil: asset('https://evil.example.com/x_0.5_2056_5728.tif'),
        plain: asset('http://data.geo.admin.ch/x_0.5_2056_5728.tif'),
        zip: { href: 'https://data.geo.admin.ch/x.zip', type: 'application/zip' },
      },
    },
  ],
};

describe('STAC DSM lookup', () => {
  it('builds a bbox query around the point', () => {
    const url = new URL(dsmItemsUrl(46.948, 7.447));
    expect(url.hostname).toBe('data.geo.admin.ch');
    expect(url.pathname).toContain('ch.swisstopo.swisssurface3d-raster/items');
    expect(url.searchParams.get('bbox')).toBe('7.44650,46.94750,7.44750,46.94850');
  });

  it('keeps only https GeoTIFFs on data.geo.admin.ch and reads the resolution', () => {
    const assets = parseStacAssets(response);
    expect(assets.map((a) => a.gsd)).toEqual([0.5, 2, 0.5]);
    expect(assets.every((a) => a.href.startsWith('https://data.geo.admin.ch/'))).toBe(true);
  });

  it('picks the finest, newest tile', () => {
    expect(pickDsmAsset(parseStacAssets(response))?.itemId).toBe('swisssurface3d-raster_2023_2600-1199');
    expect(pickDsmAsset([])).toBeNull();
  });

  it('tolerates junk', () => {
    expect(parseStacAssets(null)).toEqual([]);
    expect(parseStacAssets({ features: [null, { assets: 'x' }] })).toEqual([]);
  });
});
